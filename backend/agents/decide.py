"""Game decisions: Explorer, Survival, and Navigator analyze concurrently.
The Supervisor combines all three reports into one frontend intent.
"""

from __future__ import annotations

import asyncio
import time
import json
from typing import AsyncGenerator

from pydantic import BaseModel

from .base import K2_MODEL, get_client, sse_event, SHARED_PROMPT, load_prompt

VALID_INTENTS = ["WATCH_LIGHTS", "ENTER_LIGHTS", "GO_MEMORY", "ANSWER_MEMORY", "TRY_PATH", "GO_KEY", "GO_LOCK", "GO_DOCUMENT", "ANSWER", "GO_SAFE", "GO_EXIT"]


class GameState(BaseModel):
    visibleTiles: list[dict] = []
    recentOutcomes: list[str] = []
    firstGateOpen: bool = True
    memorySolved: bool = True
    pathSolved: bool = True
    lightPhase: str = "idle"
    memoryPhase: str = "idle"
    observedLights: list[int] = []
    observedSymbols: list[str] = []
    memoryOptions: list[list[str]] = []
    triedPaths: list[str] = []
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
            {"role": "system", "content": system + "\nBe concise: return at most two short sentences, or compact decision JSON when requested. Do not restate the full game state."},
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
    lines.append("Recent action outcomes (adjust your next decision): " + json.dumps(state.recentOutcomes))
    lines.append("Visible tiles (only these cells are observed; other locations are unknown): " + json.dumps(state.visibleTiles))
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
    """Consult every specialist, then let the Supervisor choose the action."""
    summary = _state_summary(state) + "\nOpening puzzle observations: " + json.dumps(state.model_dump(include={"firstGateOpen", "memorySolved", "pathSolved", "lightPhase", "memoryPhase", "observedLights", "observedSymbols", "memoryOptions", "triedPaths"}))
    if state.question:
        summary += "\nThe document is open. Return ANSWER with answerId A, B, or C."
    yield sse_event("agent_thinking", agent="Supervisor", message="Consulting Explorer, Survival, and Navigator.")
    reports = []
    started = time.monotonic()
    tasks = []
    async def consult(name, label):
        output = await _run_tool(name, summary + "\nAnalyze independently from the supplied observations; the Supervisor will combine the reports.")
        return label, output
    try:
        for name, (label, message) in _AGENT_LABEL.items():
            yield sse_event("agent_thinking", agent=label, message=message)
            tasks.append(asyncio.create_task(consult(name, label)))
        for completed in asyncio.as_completed(tasks):
            label, output = await completed
            reports.append(f"{label}: {output}")
            yield sse_event("agent_result", agent=label, content=output)
        yield sse_event("agent_thinking", agent="Supervisor", message="Combining all three reports into a final decision.")
        content = await _ask(SUPERVISOR_GAME, f"Current game state:\n{summary}\n\nSpecialist reports:\n" + "\n".join(reports) + "\n\nReturn your final decision JSON.")
        decision = _parse_decision(content, state)
        if not isinstance(decision, dict) or decision.get("intent") not in VALID_INTENTS:
            decision = _rule_based_intent(state)
        yield sse_event("decision", intent=decision["intent"], answerId=decision.get("answerId"), reasoning=decision.get("reasoning", ""), sequence=decision.get("sequence"), memoryIndex=decision.get("memoryIndex"), path=decision.get("path"), elapsedSeconds=round(time.monotonic() - started, 2))
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Multi-agent decision failed")
        yield sse_event("error", message="A model call failed. Check the backend logs and retry.")
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
