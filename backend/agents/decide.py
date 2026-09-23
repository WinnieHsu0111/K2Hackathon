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

VALID_INTENTS = ["PICK_FLASHLIGHT", "WATCH_LIGHTS", "ENTER_LIGHTS", "GO_MEMORY", "ANSWER_MEMORY", "TRY_PATH", "GO_KEY", "GO_LOCK", "GO_DOCUMENT", "ANSWER", "GO_SAFE", "GO_EXIT", "GO_LIGHT_1", "GO_LIGHT_2", "GO_LIGHT_3", "GO_LIGHT_4"]


class GameState(BaseModel):
    event: str | None = None
    player: str = "k2"  # which model drives the game: "k2" or "ollama" (baseline)
    # Three-level demo: 1=Light Sequence, 2=Spatial Lights, 3=Escape vs Distress
    level: int = 1
    # Level 1: Phase A = Supervisor alone (will fail), Phase B = with Observer
    lightPhaseA: bool = False   # True = currently running Phase A (solo Supervisor)
    lightPhaseAFailed: bool = False  # True = Phase A already failed, now in Phase B
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
    blockedPath: str | None = None
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
    # Level 2: spatial lights — which lights done, what order required
    spatialLightsDone: list[int] = []
    spatialLightSequence: list[int] = []
    level2Solved: bool = False
    # Level 3: distress scenario
    health: int = 100
    battery: int = 100
    exitDistance: int = 12
    distressDistance: int = 45
    distressSignalActive: bool = False


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


def _level3_state_summary(state: GameState) -> str:
    """Extra context for Level 3 (Escape vs Distress Signal)."""
    return (
        f"Current level: {state.level}; player position: {state.playerTile}\n"
        f"First gate open: {state.firstGateOpen}; memory complete: {state.memorySolved}; path solved: {state.pathSolved}\n"
        f"Has key: {state.hasKey}; lock open: {state.lockOpen}; exit gate open: {state.gateOpen}\n"
        f"Recent outcomes: {state.recentOutcomes}\n"
        f"Health: {state.health}%\n"
        f"Battery: {state.battery}%\n"
        f"Exit distance: {state.exitDistance}m\n"
        f"Distress signal distance: {state.distressDistance}m\n"
        f"Distress signal active: {state.distressSignalActive}\n"
        f"Monster active: {state.monsterActive} (state: {state.monsterState})\n"
        f"Player in safe zone: {state.playerInSafeZone}\n"
    )


async def _decide_level1_phase_a(state: GameState, summary: str, client, model: str, started: float):
    """Level 1 Phase A: Supervisor alone — scripted failure, no API call needed."""
    import random
    wrong_sequence = random.sample([1, 2, 3, 4], 3)
    if state.observedLights and wrong_sequence == state.observedLights[:3]:
        wrong_sequence = list(reversed(wrong_sequence))

    yield sse_event("agent_thinking", agent="Supervisor", message="No specialist agents available. Attempting to recall the light sequence from context alone...")
    await asyncio.sleep(1.2)
    yield sse_event("agent_result", agent="Supervisor",
                    content=f"Best guess: sequence {' → '.join(str(x) for x in wrong_sequence)}. Confidence: LOW — no observation data to verify.")
    await asyncio.sleep(0.5)
    yield sse_event("decision", intent="ENTER_LIGHTS", sequence=wrong_sequence,
                    answerId=None, reasoning="Supervisor guessed without Observer — sequence unverified.",
                    phaseAFailed=True, elapsedSeconds=round(time.monotonic() - started, 2))


async def _decide_level1_phase_b(state: GameState, summary: str, client, model: str, started: float):
    """Level 1 Phase B: Supervisor scans environment, realizes it needs Observer, then calls it."""
    yield sse_event("agent_thinking", agent="Supervisor", message="Light console active. Four panels — sequence unknown. I cannot determine the correct order alone.")
    await asyncio.sleep(0.2)
    yield sse_event("agent_thinking", agent="Supervisor", message="Dispatching Observer (Explorer) to record the flash sequence. Standing by for report.")
    yield sse_event("agent_thinking", agent="Explorer", message="Recording the three observed flashes.")
    try:
        observer_report = await asyncio.wait_for(
            _run_tool("call_explorer", summary + '\nReturn one short sentence about the observed lights.', client, model), 3.0
        )
    except Exception:
        observer_report = 'TIMEOUT: using recorded visible light observations; no model report returned.'
    yield sse_event("agent_result", agent="Explorer", content=observer_report)
    yield sse_event("agent_thinking", agent="Supervisor", message="Observer returned recorded sequence. Cross-checking and synthesizing final input...")

    # If lights aren't ready for input yet (still playing back), tell K2 to wait
    if state.lightPhase != "input":
        yield sse_event("decision", intent="WATCH_LIGHTS", answerId=None,
                        reasoning="Lights are still playing back. Observer is standing by.",
                        elapsedSeconds=round(time.monotonic() - started, 2))
        return

    seq = state.observedLights[:3] if state.observedLights else None
    if not seq or len(seq) != 3:
        yield sse_event('decision', intent='WATCH_LIGHTS', answerId=None, reasoning='Incomplete observation: watch all three flashes again.')
        return
    if not seq:
        # Try to parse from observer report as fallback
        content = await _ask(
            SUPERVISOR_GAME,
            f"Observer report: {observer_report}\n\nExtract the light sequence as JSON: "
            "{\"intent\": \"ENTER_LIGHTS\", \"sequence\": [1,2,3], \"reasoning\": \"...\"}",
            client, model
        )
        parsed = _parse_decision(content, state)
        seq = parsed.get("sequence") or [1, 2, 3]

    yield sse_event("decision", intent="ENTER_LIGHTS", sequence=seq,
                    answerId=None, reasoning=f"Observer recorded sequence: {seq}. Entering now.",
                    elapsedSeconds=round(time.monotonic() - started, 2))


async def _decide_level2(state: GameState, summary: str, client, model: str, started: float):
    """Level 2: Supervisor dispatches Observer (what?) + Navigator (how?) then acts."""
    done = state.spatialLightsDone or []
    seq = state.spatialLightSequence or [1, 2, 3, 4]
    # Fallback: if sequence missing, pick first unvisited light
    remaining = [l for l in seq if l not in done]
    next_light = seq[len(done)] if len(done) < len(seq) else (remaining[0] if remaining else 1)

    l2_summary = (
        f"LEVEL 2 — Spatial Light Sequence\n"
        f"Target sequence: {seq}\n"
        f"Lights activated so far: {done}\n"
        f"Next light to activate: {next_light}\n"
        f"Player position: {state.playerTile}\n"
        f"Monster active: {state.monsterActive}\n"
        f"Available actions: GO_LIGHT_1, GO_LIGHT_2, GO_LIGHT_3, GO_LIGHT_4\n"
    )

    # Supervisor announces dispatch plan first
    yield sse_event("agent_thinking", agent="Supervisor",
                    message=f"Light {next_light} is next in sequence ({len(done)}/{len(seq)} done). "
                            f"Dispatching Observer to confirm target, then Navigator to plot the route.")
    await asyncio.sleep(0.6)

    # Supervisor explicitly hands off to Explorer
    yield sse_event("agent_thinking", agent="Supervisor",
                    message=f"→ Calling Observer (Explorer): identify light {next_light} position.")
    await asyncio.sleep(0.3)
    yield sse_event("agent_thinking", agent="Explorer", message=f"Scanning room for light {next_light}...")
    observer_report = await asyncio.wait_for(
        _run_tool("call_explorer", l2_summary, client, model), 30.0
    )
    yield sse_event("agent_result", agent="Explorer", content=observer_report)

    # Supervisor explicitly hands off to Navigator
    yield sse_event("agent_thinking", agent="Supervisor",
                    message=f"Observer report received. → Calling Navigator: plan route to light {next_light}.")
    await asyncio.sleep(0.3)
    yield sse_event("agent_thinking", agent="Navigator", message=f"Plotting optimal path to light {next_light}...")
    nav_report = await asyncio.wait_for(
        _run_tool("call_navigator", l2_summary + f"\nObserver says: {observer_report}", client, model), 30.0
    )
    yield sse_event("agent_result", agent="Navigator", content=nav_report)

    # Supervisor synthesizes and decides
    yield sse_event("agent_thinking", agent="Supervisor",
                    message=f"All reports in. Observer + Navigator agree: GO_LIGHT_{next_light}. Executing.")
    await asyncio.sleep(0.4)
    intent = f"GO_LIGHT_{next_light}"
    yield sse_event("decision", intent=intent, answerId=None,
                    reasoning=f"Supervisor synthesized: Observer located light {next_light}, Navigator confirmed route. Decision: {intent}.",
                    elapsedSeconds=round(time.monotonic() - started, 2))


async def _decide_level3(state: GameState, started: float, client, model: str):
    """Level 3: All three specialists report, Supervisor synthesizes conflicting recommendations."""
    l3_summary = _level3_state_summary(state)

    yield sse_event("agent_thinking", agent="Supervisor", message="Key acquired. Delegating first to Survival, then Navigator.")

    async def report(name, tool):
        try:
            result = await asyncio.wait_for(_run_tool(tool, l3_summary + "\nGive one short sentence. Use the actual completed gates and inventory above.", client, model), 4.0)
            return name, result
        except Exception:
            return name, "TIMEOUT: no model report returned; engine escape fallback will be used."

    reports = []
    for name, tool in (("Survival", "call_survival"), ("Navigator", "call_navigator")):
        yield sse_event("agent_thinking", agent="Supervisor", message=f"Dispatching {name}; waiting for its report before the next delegation.")
        yield sse_event("agent_thinking", agent=name, message="Checking current inventory and escape conditions.")
        name, content = await report(name, tool)
        reports.append(f"{name}: {content}")
        yield sse_event("agent_result", agent=name, content=content)
        yield sse_event("agent_thinking", agent="Supervisor", message=f"Received {name}'s report; reviewing next action.")

    fallback = {"intent": "GO_EXIT", "reasoning": "Engine fallback: key acquired and exit gate open; proceed to exit."}
    try:
        content = await asyncio.wait_for(_ask(
            SUPERVISOR_GAME,
            l3_summary + "\n" + "\n".join(reports) +
            '\nChoose GO_EXIT, or GO_SAFE only if a temporary shelter is necessary and player is not already safe. Return JSON with intent and reasoning.',
            client, model), 2.0)
        decision = _parse_decision(content, state)
        if decision.get("intent") not in ("GO_EXIT", "GO_SAFE") or (state.playerInSafeZone and decision.get("intent") == "GO_SAFE"):
            decision = fallback
    except Exception:
        decision = fallback
    yield sse_event("agent_result", agent="Supervisor", content=decision.get("reasoning", "Proceeding to exit."))
    yield sse_event("decision", intent=decision["intent"], answerId=None,
                    reasoning=decision.get("reasoning", ""),
                    elapsedSeconds=round(time.monotonic() - started, 2))


async def decide(state: GameState) -> AsyncGenerator[str, None]:
    """Three-level multi-agent demo.

    Level 1: Specialization — Supervisor alone fails, then Observer helps it succeed.
    Level 2: Collaboration — Observer (what?) + Navigator (how?) + Supervisor (act).
    Level 3: Synthesis — All three agents report, Supervisor resolves conflict.
    """
    summary = _state_summary(state) + "\nOpening puzzle observations: " + json.dumps(
        state.model_dump(include={"firstGateOpen", "memorySolved", "pathSolved", "lightPhase",
                                   "memoryPhase", "observedLights", "observedSymbols", "memoryOptions", "triedPaths"})
    )
    if state.question:
        summary += "\nThe document is open. Return ANSWER with answerId A, B, or C."
    started = time.monotonic()

    from .base import get_baseline_client, BASELINE_MODEL
    if state.player == "ollama":
        client, model = get_baseline_client(), BASELINE_MODEL
    else:
        client, model = get_client(), K2_MODEL

    if state.event == 'ENEMY_DETECTED':
        yield sse_event('agent_thinking', agent='Supervisor', message='Monster detected. Delegating immediate risk assessment to Survival.')
        yield sse_event('agent_thinking', agent='Survival', message='Assessing the monster and retreat options.')
        try:
            report = await asyncio.wait_for(_run_tool('call_survival', summary, client, model), 4.0)
        except Exception:
            report = 'TIMEOUT: Survival unavailable; engine emergency retreat remains active.'
        yield sse_event('agent_result', agent='Survival', content=report)
        yield sse_event('agent_thinking', agent='Supervisor', message='Reviewing Survival report while the player retreats.')
        try:
            reason = await asyncio.wait_for(_ask(SUPERVISOR_GAME, summary + '\nSurvival: ' + report + '\nGive one short retreat recommendation.', client, model), 2.0)
        except Exception:
            reason = 'Engine fallback: continue emergency retreat; avoid the remembered blocked corridor.'
        yield sse_event('agent_result', agent='Supervisor', content=reason)
        yield sse_event('decision', intent='GO_SAFE', reasoning=reason, answerId=None)
        return

    # Level 3: all three agents, conflict resolution
    # The escape-vs-distress dilemma only exists once the exit gate is open;
    # before that, fall through to the normal key → lock → document flow.
    if state.level == 3 and state.gateOpen and state.hasKey:
        async for event in _decide_level3(state, started, client, model):
            yield event
        return

    # Level 2: Observer + Navigator collaboration
    if state.level == 2:
        # Shortest-path ambush demo: Navigator owns the route choice; the
        # engine reveals the ambush on the first attempt and records it.
        if not state.pathSolved:
            tried = set(state.triedPaths or [])
            path = next((p for p in ("CENTER", "LEFT", "RIGHT") if p not in tried), "CENTER")
            yield sse_event("agent_thinking", agent="Supervisor", message="Delegating corridor comparison to Navigator.")
            yield sse_event("agent_thinking", agent="Navigator", message="Comparing corridor lengths...")
            if tried:
                memory = ", ".join(sorted(tried))
                yield sse_event("agent_result", agent="Navigator",
                                content=f"MEMORY: last attempt via {memory} failed (monster ambush). Excluding {memory}. "
                                        f"Next shortest safe route: {path}.")
            else:
                yield sse_event("agent_result", agent="Navigator", content=f"The {path.lower()} corridor is currently the shortest route.")
            yield sse_event("decision", intent="TRY_PATH", path=path, answerId=None,
                            reasoning=f"Navigator selected the shortest untried corridor: {path}.",
                            elapsedSeconds=round(time.monotonic() - started, 2))
            return
        opening = _opening_fast_decision(state)
        if opening is not None:
            yield sse_event("agent_result", agent="Supervisor", content=f"Fast rule: {opening['reasoning']}")
            yield sse_event("decision", intent=opening["intent"], answerId=opening.get("answerId"),
                            reasoning=opening.get("reasoning", ""), sequence=opening.get("sequence"),
                            memoryIndex=opening.get("memoryIndex"), path=opening.get("path"),
                            elapsedSeconds=round(time.monotonic() - started, 2))
            return
        async for event in _decide_level2(state, summary, client, model, started):
            yield event
        return

    # Level 1: Specialization demo
    if state.level == 1:
        # Only use fast rules for pre-light navigation (flashlight pickup, walking to console).
        # Once the light puzzle is active, hand off to Phase A/B so agents are always called.
        if not state.hasFlashlight:
            yield sse_event("agent_result", agent="Supervisor", content="Opening rule: collect the flashlight first.")
            yield sse_event("decision", intent="PICK_FLASHLIGHT", answerId=None,
                            reasoning="Opening rule: collect the flashlight first.",
                            elapsedSeconds=round(time.monotonic() - started, 2))
            return
        if not state.firstGateOpen and state.lightPhase not in ("input",):
            # Still navigating to the light console — fast rule, no agent needed
            yield sse_event("agent_result", agent="Supervisor", content="Navigating to light console.")
            yield sse_event("decision", intent="WATCH_LIGHTS", answerId=None,
                            reasoning="Opening rule: reach the light console and watch the sequence.",
                            elapsedSeconds=round(time.monotonic() - started, 2))
            return
        # Gate not open yet: always call Explorer to record sequence, then enter lights
        if not state.firstGateOpen:
            async for event in _decide_level1_phase_b(state, summary, client, model, started):
                yield event
            return

    # Default: dynamic Supervisor tool-calling (original logic for other game states)
    messages = [
        {"role": "system", "content": SUPERVISOR_GAME},
        {"role": "user", "content": f"Current game state:\n{summary}\n\nRoute this turn dynamically: call at least one relevant specialist before deciding. "
         "Use Explorer for unclear observations, Navigator for objective/puzzle routing, "
         "and Survival only for threat signals. Wait for the selected report(s), then output the final decision JSON."},
    ]

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

            if not msg.tool_calls:
                if not forced_specialist:
                    forced_specialist = True
                    yield sse_event("agent_thinking", agent="Navigator", message="Requesting a specialist recommendation...")
                    try:
                        report = await asyncio.wait_for(_run_tool("call_navigator", summary, client, model), 4.0)
                    except asyncio.TimeoutError:
                        report = "Navigator timed out."
                    yield sse_event("agent_result", agent="Navigator", content=report)
                    messages.append({"role": "user", "content": f"Navigator report:\n{report}\nOutput the final decision JSON."})
                    continue
                decision = _parse_decision(msg.content or "", state)
                if not isinstance(decision, dict) or decision.get("intent") not in VALID_INTENTS:
                    decision = _rule_based_intent(state)
                yield sse_event("decision", intent=decision["intent"], answerId=decision.get("answerId"),
                                reasoning=decision.get("reasoning", ""), sequence=decision.get("sequence"),
                                memoryIndex=decision.get("memoryIndex"), path=decision.get("path"),
                                elapsedSeconds=round(time.monotonic() - started, 2))
                return

            messages.append(msg.model_dump(exclude_unset=True))
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
                    output = f"{label} timed out."
                yield sse_event("agent_result", agent=label, content=output)
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": output})

        yield sse_event("agent_thinking", agent="Supervisor", message="Finalizing the decision...")
        content = await _ask(SUPERVISOR_GAME, f"Current game state:\n{summary}\n\nOutput your final decision JSON now.", client, model)
        decision = _parse_decision(content, state)
        if not isinstance(decision, dict) or decision.get("intent") not in VALID_INTENTS:
            decision = _rule_based_intent(state)
        yield sse_event("decision", intent=decision["intent"], answerId=decision.get("answerId"),
                        reasoning=decision.get("reasoning", ""), sequence=decision.get("sequence"),
                        memoryIndex=decision.get("memoryIndex"), path=decision.get("path"),
                        elapsedSeconds=round(time.monotonic() - started, 2))
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Multi-agent decision failed")
        yield sse_event("error", message="A model call failed. Check the backend logs and retry.")
