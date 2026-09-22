"""Supervisor — orchestrates all agents and runs the game loop."""

from __future__ import annotations

import textwrap
from typing import AsyncGenerator

from .base import K2_MODEL, get_client, sse_event
from .explorer import call_explorer
from .survival import call_survival
from .navigator import call_navigator
from game_state import LEVELS, get_memory_summary, record_attempt


SUPERVISOR_PROMPT = """You are the game supervisor for a Backrooms escape scenario.
Judge the Navigator's action against the room conditions.
Reply with exactly two lines:
1. One verdict: SUCCESS, DANGER, or CONTINUE.
2. A brief reason.
v g
The exit condition is: {exit_condition}
The danger condition is: {danger_condition}
"""




async def judge_action(action: str, room: dict) -> tuple[str, str]:
    """Ask K2 to judge whether the action succeeds, fails, or continues."""
    client = get_client()
    prompt = SUPERVISOR_PROMPT.format(
        exit_condition=room["exit_condition"]["action"],
        danger_condition=room["danger"]["action"],
    )
    r = await client.chat.completions.create(
        model=K2_MODEL,
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": f"Navigator's action: {action}"},
        ],
    )
    content = r.choices[0].message.content.strip()
    lines = content.split("\n", 1)
    verdict = lines[0].strip().upper()
    reason = lines[1].strip() if len(lines) > 1 else ""
    if verdict not in ("SUCCESS", "DANGER", "CONTINUE"):
        verdict = "CONTINUE"
    return verdict, reason


async def run_backrooms(level_id: int) -> AsyncGenerator[str, None]:
    room = LEVELS.get(level_id)
    if not room:
        yield sse_event("error", message=f"Level {level_id} not found.")
        return

    yield sse_event("level_start", level=level_id, name=room["name"], description=room["description"])

    memory_summary = get_memory_summary()
    max_attempts = 3

    for attempt in range(1, max_attempts + 1):
        yield sse_event("attempt_start", attempt=attempt)

        # Explorer
        yield sse_event("agent_thinking", agent="Explorer", message="Scanning the environment...")
        explorer_output = await call_explorer(room)
        yield sse_event("agent_result", agent="Explorer", content=explorer_output)

        # Survival
        yield sse_event("agent_thinking", agent="Survival", message="Assessing dangers...")
        survival_output = await call_survival(room, explorer_output)
        yield sse_event("agent_result", agent="Survival", content=survival_output)

        # Navigator
        yield sse_event("agent_thinking", agent="Navigator", message="Deciding next action...")
        navigator_output = await call_navigator(room, explorer_output, survival_output, memory_summary)
        yield sse_event("agent_result", agent="Navigator", content=navigator_output)

        # Extract action
        action = navigator_output
        if "ACTION:" in navigator_output:
            action = navigator_output.split("ACTION:")[1].split("\n")[0].strip()

        yield sse_event("action_taken", action=action)

        # Supervisor judges the action
        yield sse_event("agent_thinking", agent="Supervisor", message="Judging action...")
        verdict, reason = await judge_action(action, room)
        yield sse_event("agent_result", agent="Supervisor", content=f"{verdict}: {reason}")

        if verdict == "SUCCESS":
            record_attempt(level_id, action, "success", reason)
            yield sse_event("level_complete", level=level_id, message=room["exit_condition"]["description"])
            return
        elif verdict == "DANGER":
            record_attempt(level_id, action, "death", reason)
            yield sse_event("attempt_failed", attempt=attempt, message=room["danger"]["description"])
            memory_summary = get_memory_summary()
        else:
            record_attempt(level_id, action, "no_progress", reason)
            yield sse_event("attempt_failed", attempt=attempt, message=f"No progress: {reason}")
            memory_summary = get_memory_summary()

    yield sse_event("game_over", message="K2 failed to escape this level after 3 attempts.")
