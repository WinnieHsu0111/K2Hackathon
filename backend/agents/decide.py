"""
Decision loop for K2-plays-the-game mode.

The Supervisor is the main agent. It orchestrates three specialist agents
(explorer, survival, navigator) via tool calling — it decides which agents
to call, and how many, each turn — then outputs a final intent for the frontend
to execute via BFS pathfinding.
"""

from __future__ import annotations

import json
from typing import AsyncGenerator

from pydantic import BaseModel

from .base import K2_MODEL, get_client, sse_event, SHARED_PROMPT, load_prompt

VALID_INTENTS = ["GO_KEY", "GO_LOCK", "GO_DOCUMENT", "ANSWER", "GO_SAFE", "GO_EXIT"]


class GameState(BaseModel):
    hasKey: bool = False
    lockOpen: bool = False
    gateOpen: bool = False
    documentAnswered: bool = False
    atDocument: bool = False  # is the player standing at the document?
    monsterActive: bool = False
    playerInSafeZone: bool = False
    monsterState: str = "PATROL"
    playerTile: dict = {"x": 0, "y": 0}
    monsterTile: dict = {"x": 0, "y": 0}
    question: dict | None = None


# Specialist agent prompts (edit these + shared.txt for prompt engineering)
EXPLORER_GAME = SHARED_PROMPT + "\n\n" + load_prompt("game_explorer")
SURVIVAL_GAME = SHARED_PROMPT + "\n\n" + load_prompt("game_survival")
NAVIGATOR_GAME = SHARED_PROMPT + "\n\n" + load_prompt("game_navigator")
SUPERVISOR_GAME = SHARED_PROMPT + "\n\n" + load_prompt("game_supervisor")

MAX_TURNS = 6  # cap tool-calling rounds so we always return a decision


# Tools the Supervisor can call
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "call_explorer",
            "description": "Observe and describe the current situation.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "call_survival",
            "description": "Assess the monster threat and how urgent fleeing is.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "call_navigator",
            "description": "Propose a concrete next action with reasoning.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
]


async def _ask(system: str, user: str) -> str:
    client = get_client()
    r = await client.chat.completions.create(
        model=K2_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return r.choices[0].message.content.strip()


def _state_summary(state: GameState) -> str:
    lines = [
        f"Has key: {state.hasKey}",
        f"Code door open: {state.lockOpen}",
        f"Gate open: {state.gateOpen}",
        f"Puzzle answered: {state.documentAnswered}",
        f"Player is at the document: {state.atDocument}",
        f"Monster active: {state.monsterActive} (state: {state.monsterState})",
        f"Player in safe zone: {state.playerInSafeZone}",
        f"Player position: {state.playerTile}",
        f"Monster position: {state.monsterTile}",
    ]
    if state.question:
        lines.append(f"Question: {state.question.get('prompt', 'Not supplied')}")
        lines.append(f"Puzzle rule: {state.question.get('rule', 'unknown')}")
        opts = state.question.get("options", [])
        lines.append("Options: " + ", ".join(f"{o['id']}={o['value']}" for o in opts))
    return "\n".join(lines)


async def _run_tool(name: str, summary: str) -> str:
    """Run a specialist agent and return its text output."""
    if name == "call_explorer":
        return await _ask(EXPLORER_GAME, f"Current game state:\n{summary}")
    if name == "call_survival":
        return await _ask(SURVIVAL_GAME, f"Current game state:\n{summary}")
    if name == "call_navigator":
        return await _ask(NAVIGATOR_GAME, f"Current game state:\n{summary}\n\nPropose the next action.")
    return f"Unknown tool: {name}"


_AGENT_LABEL = {
    "call_explorer": ("Explorer", "Observing the environment..."),
    "call_survival": ("Survival", "Assessing the threat..."),
    "call_navigator": ("Navigator", "Proposing an action..."),
}


def _rule_based_intent(state: GameState) -> dict:
    """Deterministic fallback: pick the correct intent straight from the state,
    following the same priority order the agents use. Used when the LLM's JSON
    can't be parsed, so the game never stalls."""
    if state.monsterActive and state.monsterState == "CHASE" and not state.playerInSafeZone:
        return {"intent": "GO_SAFE", "answerId": None, "reasoning": "(rule) Monster chasing — flee to safe zone."}
    if not state.hasKey:
        return {"intent": "GO_KEY", "answerId": None, "reasoning": "(rule) No key yet — go get it."}
    if not state.lockOpen:
        return {"intent": "GO_LOCK", "answerId": None, "reasoning": "(rule) Have key, door closed — open it."}
    if not state.documentAnswered and not state.atDocument:
        return {"intent": "GO_DOCUMENT", "answerId": None, "reasoning": "(rule) Door open — go to the document."}
    if not state.documentAnswered and state.atDocument:
        answer = _deduce_answer(state)
        return {"intent": "ANSWER", "answerId": answer, "reasoning": "(rule) At document — answer the puzzle."}
    if state.gateOpen and state.documentAnswered:
        return {"intent": "GO_EXIT", "answerId": None, "reasoning": "(rule) Puzzle done — head to the exit."}
    return {"intent": "GO_KEY", "answerId": None, "reasoning": "(rule) Default."}


def _deduce_answer(state: GameState) -> str | None:
    """Best-effort: if the puzzle rule is 'odd', pick the even option, etc.
    Falls back to the first option if we can't tell."""
    if not state.question:
        return "A"
    opts = state.question.get("options", [])
    rule = (state.question.get("rule") or "").lower()
    if "odd" in rule or "奇" in rule:
        for o in opts:
            try:
                if int(o["value"]) % 2 == 0:
                    return o["id"]
            except (ValueError, KeyError):
                pass
    if "even" in rule or "偶" in rule:
        for o in opts:
            try:
                if int(o["value"]) % 2 == 1:
                    return o["id"]
            except (ValueError, KeyError):
                pass
    return opts[0]["id"] if opts else "A"


def _parse_decision(content: str, state: GameState) -> dict:
    if content.startswith("```"):
        content = content.split("```")[1]
        if content.startswith("json"):
            content = content[4:]
    content = content.strip()
    # Try to find a JSON object even if there's surrounding prose.
    if not content.startswith("{") and "{" in content:
        content = content[content.index("{"):content.rindex("}") + 1]
    try:
        return json.loads(content)
    except Exception:
        return _rule_based_intent(state)


async def decide(state: GameState) -> AsyncGenerator[str, None]:
    client = get_client()
    summary = _state_summary(state)
    if state.question:
        summary += "\nThe document is open now. Your ONLY legal intent for this turn is ANSWER. Solve the question and provide answerId A, B, or C."

    messages = [
        {"role": "system", "content": SUPERVISOR_GAME},
        {"role": "user", "content": f"Current game state:\n{summary}\n\nDecide the next intent. Call agents as needed."},
    ]

    yield sse_event("agent_thinking", agent="Supervisor", message="Deciding which agents to consult...")

    for _turn in range(MAX_TURNS):
        r = await client.chat.completions.create(
            model=K2_MODEL,
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
        )
        msg = r.choices[0].message

        # No tool call → Supervisor is giving the final decision
        if not msg.tool_calls:
            decision = _parse_decision(msg.content or "", state)
            intent = decision.get("intent", "GO_KEY")
            if intent not in VALID_INTENTS:
                decision = _rule_based_intent(state)
                intent = decision["intent"]
            yield sse_event(
                "decision",
                intent=intent,
                answerId=decision.get("answerId"),
                reasoning=decision.get("reasoning", ""),
            )
            return

        # Execute each tool the Supervisor called
        messages.append(msg.model_dump(exclude_unset=True))
        for tc in msg.tool_calls:
            name = tc.function.name
            label, thinking = _AGENT_LABEL.get(name, ("Agent", "Working..."))
            yield sse_event("agent_thinking", agent=label, message=thinking)

            output = await _run_tool(name, summary)
            yield sse_event("agent_result", agent=label, content=output)

            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": output,
            })

    # Hit the turn cap without a final decision — ask once more, plainly
    yield sse_event("agent_thinking", agent="Supervisor", message="Finalizing decision...")
    final = await _ask(
        SUPERVISOR_GAME,
        f"Current game state:\n{summary}\n\nOutput your final decision JSON now.",
    )
    decision = _parse_decision(final, state)
    intent = decision.get("intent", "GO_KEY")
    if intent not in VALID_INTENTS:
        decision = _rule_based_intent(state)
        intent = decision["intent"]
    yield sse_event(
        "decision",
        intent=intent,
        answerId=decision.get("answerId"),
        reasoning=decision.get("reasoning", ""),
    )
