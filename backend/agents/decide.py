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

VALID_INTENTS = ["PICK_FLASHLIGHT", "WATCH_LIGHTS", "ENTER_LIGHTS", "GO_MEMORY", "ANSWER_MEMORY", "TRY_PATH", "GO_KEY", "GO_LOCK", "GO_DOCUMENT", "ANSWER", "GO_SAFE", "GO_EXIT"]


class GameState(BaseModel):
    player: str = "k2"  # which model drives the game: "k2" or "ollama" (baseline)
    visibleTiles: list[dict] = []
    recentOutcomes: list[str] = []
    trajectory: list[str] = []  # full decision history so far (never truncated)
    firstGateOpen: bool = True
    memorySolved: bool = True
    pathSolved: bool = True
    lightPhase: str = "idle"
    memoryPhase: str = "idle"
    observedLights: list[int] = []
    observedSymbols: list[str] = []
    memoryOptions: list[list[str]] = []
    triedPaths: list[str] = []
    hasFlashlight: bool = True
    hasDocument: bool = False
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


async def _ask(system: str, user: str, client=None, model: str = K2_MODEL) -> str:
    client = client or get_client()
    r = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system + "\nBe concise: return at most two short sentences, or compact decision JSON when requested. Do not restate the full game state."},
            {"role": "user", "content": user},
        ],
    )
    return (r.choices[0].message.content or "").strip()


def _state_summary(state: GameState) -> str:
    lines = [
        f"Flashlight equipped: {state.hasFlashlight}",
        f"Scroll collected: {state.hasDocument}",
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
    if state.trajectory:
        lines.append(
            f"\nFULL DECISION HISTORY so far ({len(state.trajectory)} steps, oldest first). "
            "Reason over this entire trajectory: do not repeat failed actions, build on what worked, "
            "and stay consistent with the plan you have been following:"
        )
        lines.extend(f"  {i+1}. {step}" for i, step in enumerate(state.trajectory))
    lines.append("Visible tiles (only these cells are observed; other locations are unknown): " + json.dumps(state.visibleTiles))
    if state.question:
        lines.append(f"Question: {state.question.get('prompt', 'Not supplied')}")
        lines.append(f"Puzzle rule: {state.question.get('rule', 'unknown')}")
        opts = state.question.get("options", [])
        lines.append("Options: " + ", ".join(f"{o['id']}={o['value']}" for o in opts))
    return "\n".join(lines)


async def _run_tool(name: str, summary: str, client=None, model: str = K2_MODEL) -> str:
    """Run a specialist agent and return its text output."""
    if name == "call_explorer":
        return await _ask(EXPLORER_GAME, f"Current game state:\n{summary}", client, model)
    if name == "call_survival":
        return await _ask(SURVIVAL_GAME, f"Current game state:\n{summary}", client, model)
    if name == "call_navigator":
        return await _ask(NAVIGATOR_GAME, f"Current game state:\n{summary}\n\nPropose the next action.", client, model)
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
    if not state.hasFlashlight:
        return {"intent": "PICK_FLASHLIGHT", "answerId": None, "reasoning": "(rule) No flashlight — collect it before exploring."}
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


def _opening_fast_decision(state: GameState) -> dict | None:
    """Resolve deterministic opening-room gates without a slow model round."""
    if not state.hasFlashlight:
        return {"intent": "PICK_FLASHLIGHT", "answerId": None, "reasoning": "Opening rule: collect the flashlight first."}
    if not state.firstGateOpen:
        if state.lightPhase == "input" and len(state.observedLights) == 3:
            return {"intent": "ENTER_LIGHTS", "sequence": state.observedLights, "answerId": None, "reasoning": "Opening rule: replay the three observed lights."}
        return {"intent": "WATCH_LIGHTS", "answerId": None, "reasoning": "Opening rule: watch the light sequence before entering it."}
    if not state.memorySolved:
        if state.memoryPhase == "input" and len(state.observedSymbols) == 5 and state.memoryOptions:
            target = tuple(state.observedSymbols)
            for i, option in enumerate(state.memoryOptions):
                if tuple(option) == target:
                    return {"intent": "ANSWER_MEMORY", "memoryIndex": i, "answerId": None, "reasoning": "Memory rule: choose the option matching the full revealed symbol order."}
        return {"intent": "GO_MEMORY", "answerId": None, "reasoning": "Opening rule: reach the memory console and record the full reveal."}
    if not state.pathSolved:
        for path in ("LEFT", "CENTER", "RIGHT"):
            if path not in state.triedPaths:
                return {"intent": "TRY_PATH", "path": path, "answerId": None, "reasoning": f"Opening rule: test an untried corridor ({path})."}
    return None


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
    """The Supervisor DYNAMICALLY orchestrates the specialists via tool calling.

    K2 (the Supervisor) reads the game state — including the full decision
    trajectory — and itself decides which specialists to consult and how many:
    an obvious step may need none, a dangerous or ambiguous one may need all
    three across several rounds. It then outputs the final intent. This is the
    multi-agent orchestration: the routing is reasoned by K2, not hard-coded.
    """
    summary = _state_summary(state) + "\nOpening puzzle observations: " + json.dumps(state.model_dump(include={"firstGateOpen", "memorySolved", "pathSolved", "lightPhase", "memoryPhase", "observedLights", "observedSymbols", "memoryOptions", "triedPaths"}))
    if state.question:
        summary += "\nThe document is open. Return ANSWER with answerId A, B, or C."
    started = time.monotonic()

    # Which model drives this run: K2 Horizon, or the small Ollama baseline. Both
    # use the SAME multi-agent orchestration, so a side-by-side full playthrough is
    # a fair "why K2" demo — the only variable is the model.
    from .base import get_baseline_client, BASELINE_MODEL
    if state.player == "ollama":
        client, model = get_baseline_client(), BASELINE_MODEL
    else:
        client, model = get_client(), K2_MODEL

    messages = [
        {"role": "system", "content": SUPERVISOR_GAME},
        {"role": "user", "content": f"Current game state:\n{summary}\n\nRoute this turn dynamically: call at least one relevant specialist before deciding. "
         "Use Explorer for unclear observations, Navigator for objective/puzzle routing, "
         "and Survival only for threat signals. Wait for the selected report(s), then output the final decision JSON."},
    ]

    # The first room is deterministic. Keep Supervisor as the visible entry
    # point, but use a fast Navigator-style report instead of spending a full
    # model round on fixed light/memory/path rules.
    opening = _opening_fast_decision(state)
    if opening is not None:
        # Opening gates have explicit engine rules. Do not make the Supervisor
        # spend an LLM round deciding which specialist to call for them.
        yield sse_event("agent_result", agent="Supervisor", content=f"Fast rule applied: {opening['reasoning']}")
        yield sse_event("decision", intent=opening["intent"], answerId=opening.get("answerId"), reasoning=opening.get("reasoning", ""), sequence=opening.get("sequence"), memoryIndex=opening.get("memoryIndex"), path=opening.get("path"), elapsedSeconds=round(time.monotonic() - started, 2))
        return

    yield sse_event("agent_thinking", agent="Supervisor", message="Deciding which specialists to consult...")

    forced_specialist = False
    try:
        for _turn in range(MAX_TURNS):
            if _turn > 0:
                yield sse_event("agent_thinking", agent="Supervisor", message="Reviewing specialist reports...")
            r = await client.chat.completions.create(
                model=model, messages=messages, tools=TOOLS, tool_choice="auto",
            )
            msg = r.choices[0].message

            # No tool call → the Supervisor is giving its final decision.
            if not msg.tool_calls:
                if not forced_specialist:
                    # Never allow a Supervisor-only turn. Ask Navigator for a
                    # concrete recommendation, then give the Supervisor one
                    # more chance to integrate it and emit the final JSON.
                    forced_specialist = True
                    yield sse_event("agent_thinking", agent="Navigator", message="Requesting a specialist recommendation...")
                    try:
                        report = await asyncio.wait_for(_run_tool("call_navigator", summary, client, model), 4.0)
                    except asyncio.TimeoutError:
                        report = "Navigator timed out; use the confirmed game state and deterministic preconditions."
                    yield sse_event("agent_result", agent="Navigator", content=report)
                    messages.append({"role": "user", "content": f"Navigator report:\n{report}\nIntegrate this report and now output the final decision JSON."})
                    continue
                decision = _parse_decision(msg.content or "", state)
                if not isinstance(decision, dict) or decision.get("intent") not in VALID_INTENTS:
                    decision = _rule_based_intent(state)
                yield sse_event("decision", intent=decision["intent"], answerId=decision.get("answerId"), reasoning=decision.get("reasoning", ""), sequence=decision.get("sequence"), memoryIndex=decision.get("memoryIndex"), path=decision.get("path"), elapsedSeconds=round(time.monotonic() - started, 2))
                return

            # The Supervisor chose to consult one or more specialists this round.
            messages.append(msg.model_dump(exclude_unset=True))
            # Specialist reports are independent. Run them concurrently so the
            # visible multi-agent turn does not multiply latency in the opening room.
            calls = []
            for tc in msg.tool_calls:
                name = tc.function.name
                label, thinking = _AGENT_LABEL.get(name, ("Agent", "Working..."))
                yield sse_event("agent_thinking", agent=label, message=thinking)
                calls.append((tc, name, label, asyncio.create_task(asyncio.wait_for(_run_tool(name, summary, client, model), 4.0))))
            for tc, name, label, task in calls:
                try:
                    output = await task
                except asyncio.TimeoutError:
                    output = f"{label} timed out; Supervisor should continue with available evidence."
                yield sse_event("agent_result", agent=label, content=output)
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": output})

        # Hit the round cap without a final decision — ask once more, plainly.
        yield sse_event("agent_thinking", agent="Supervisor", message="Finalizing the decision...")
        content = await _ask(SUPERVISOR_GAME, f"Current game state:\n{summary}\n\nOutput your final decision JSON now.", client, model)
        decision = _parse_decision(content, state)
        if not isinstance(decision, dict) or decision.get("intent") not in VALID_INTENTS:
            decision = _rule_based_intent(state)
        yield sse_event("decision", intent=decision["intent"], answerId=decision.get("answerId"), reasoning=decision.get("reasoning", ""), sequence=decision.get("sequence"), memoryIndex=decision.get("memoryIndex"), path=decision.get("path"), elapsedSeconds=round(time.monotonic() - started, 2))
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Multi-agent decision failed")
        yield sse_event("error", message="A model call failed. Check the backend logs and retry.")
