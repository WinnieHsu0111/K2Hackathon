"""
Backrooms multi-agent system.

Supervisor orchestrates Explorer, Survival, Navigator, and Memory agents.
Each sub-agent is a separate K2 API call with its own system prompt.
"""

from __future__ import annotations

import json
import os
import textwrap
from typing import AsyncGenerator

from dotenv import load_dotenv
from openai import AsyncOpenAI

from game_state import LEVELS, get_memory_summary, record_attempt

load_dotenv()

K2_API_KEY = os.getenv("K2_API_KEY", "")
K2_BASE_URL = os.getenv("K2_BASE_URL", "https://api.ifm.ai/v1")
K2_MODEL = os.getenv("K2_MODEL", "IFM/K2-Horizon-375B-A23B")

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=K2_API_KEY, base_url=K2_BASE_URL)
    return _client


def _event(kind: str, **payload) -> str:
    return "data: " + json.dumps({"type": kind, **payload}) + "\n\n"


# ---------------------------------------------------------------------------
# System prompts — your team edits these
# ---------------------------------------------------------------------------

EXPLORER_PROMPT = textwrap.dedent("""
You are the Explorer agent in a Backrooms survival game.
Your job: carefully observe the environment and identify ALL clues and items.
Be methodical. List every object, sound, smell, and visual detail.
Do NOT make decisions or recommendations — only report what you observe.
Format your response as a clear list of observations.
""").strip()

SURVIVAL_PROMPT = textwrap.dedent("""
You are the Survival Instinct agent in a Backrooms survival game.
Your job: assess danger levels for each possible action.
Given the explorer's observations, identify:
- What is dangerous and why
- What seems safe
- What is unknown/uncertain
Be paranoid. The Backrooms is deadly. Better to be overly cautious.
Do NOT decide what to do — only assess risk.
""").strip()

NAVIGATOR_PROMPT = textwrap.dedent("""
You are the Navigator agent in a Backrooms survival game.
Your job: decide the single best action to take right now.
You will receive:
- Explorer's observations
- Survival's risk assessment
- Memory of past failures

Based on all this, choose ONE specific action and explain your reasoning.
Your action must be concrete and specific (e.g. "read the crumpled note", "enter code 1984 on the keypad").
Format: ACTION: <your chosen action>\nREASONING: <why>
""").strip()

SUPERVISOR_PROMPT = textwrap.dedent("""
You are the Supervisor agent coordinating a team trying to escape the Backrooms.
You have three specialist agents available as tools:
- explorer: observes the environment
- survival: assesses dangers
- navigator: decides the next action

Your job:
1. Call explorer first to understand the environment
2. Call survival with explorer's findings to assess dangers
3. Call navigator with all gathered information to decide the action
4. Evaluate the navigator's chosen action against the room's exit condition
5. Return a final decision: the action to take

Be efficient. You can call agents multiple times if needed, but aim for 3-4 calls max.
Always end with a FINAL_ACTION in your response.
""").strip()


# ---------------------------------------------------------------------------
# Sub-agent callers
# ---------------------------------------------------------------------------

async def call_explorer(room: dict) -> str:
    client = _get_client()
    r = await client.chat.completions.create(
        model=K2_MODEL,
        messages=[
            {"role": "system", "content": EXPLORER_PROMPT},
            {"role": "user", "content": f"Room: {room['name']}\n\n{room['description']}\n\nItems present: {', '.join(room['items'])}"},
        ],
    )
    return r.choices[0].message.content


async def call_survival(room: dict, explorer_output: str) -> str:
    client = _get_client()
    r = await client.chat.completions.create(
        model=K2_MODEL,
        messages=[
            {"role": "system", "content": SURVIVAL_PROMPT},
            {"role": "user", "content": f"Room: {room['name']}\n\nExplorer's observations:\n{explorer_output}"},
        ],
    )
    return r.choices[0].message.content


async def call_navigator(room: dict, explorer_output: str, survival_output: str, memory: str) -> str:
    client = _get_client()
    r = await client.chat.completions.create(
        model=K2_MODEL,
        messages=[
            {"role": "system", "content": NAVIGATOR_PROMPT},
            {"role": "user", "content": (
                f"Room: {room['name']}\n\n"
                f"Explorer's observations:\n{explorer_output}\n\n"
                f"Survival assessment:\n{survival_output}\n\n"
                f"Memory of past failures:\n{memory}"
            )},
        ],
    )
    return r.choices[0].message.content


# ---------------------------------------------------------------------------
# Check if navigator's action matches exit condition
# ---------------------------------------------------------------------------

def check_exit(action: str, room: dict) -> tuple[bool, bool]:
    """Returns (is_exit, is_danger)."""
    action_lower = action.lower()
    exit_keywords = room["exit_condition"]["answer"].lower().split()
    danger_keywords = room["danger"]["action"].lower().split()

    is_exit = sum(1 for kw in exit_keywords if kw in action_lower) >= len(exit_keywords) // 2 + 1
    is_danger = sum(1 for kw in danger_keywords if kw in action_lower) >= 1

    return is_exit, is_danger


# ---------------------------------------------------------------------------
# Main agent loop
# ---------------------------------------------------------------------------

async def run_backrooms(level_id: int) -> AsyncGenerator[str, None]:
    room = LEVELS.get(level_id)
    if not room:
        yield _event("error", message=f"Level {level_id} not found.")
        return

    yield _event("level_start", level=level_id, name=room["name"], description=room["description"])

    memory_summary = get_memory_summary()
    max_attempts = 3

    for attempt in range(1, max_attempts + 1):
        yield _event("attempt_start", attempt=attempt)

        # Explorer
        yield _event("agent_thinking", agent="Explorer", message="Scanning the environment...")
        explorer_output = await call_explorer(room)
        yield _event("agent_result", agent="Explorer", content=explorer_output)

        # Survival
        yield _event("agent_thinking", agent="Survival", message="Assessing dangers...")
        survival_output = await call_survival(room, explorer_output)
        yield _event("agent_result", agent="Survival", content=survival_output)

        # Navigator
        yield _event("agent_thinking", agent="Navigator", message="Deciding next action...")
        navigator_output = await call_navigator(room, explorer_output, survival_output, memory_summary)
        yield _event("agent_result", agent="Navigator", content=navigator_output)

        # Extract action
        action = navigator_output
        if "ACTION:" in navigator_output:
            action = navigator_output.split("ACTION:")[1].split("\n")[0].strip()

        yield _event("action_taken", action=action)

        # Check outcome
        is_exit, is_danger = check_exit(action, room)

        if is_exit:
            record_attempt(level_id, action, "success", "Found the exit")
            yield _event("level_complete", level=level_id, message=room["exit_condition"]["description"])
            return
        elif is_danger:
            record_attempt(level_id, action, "death", room["danger"]["description"])
            yield _event("attempt_failed", attempt=attempt, message=room["danger"]["description"])
            memory_summary = get_memory_summary()
        else:
            record_attempt(level_id, action, "no_progress", "Action had no clear outcome")
            yield _event("attempt_failed", attempt=attempt, message="That action didn't lead anywhere useful.")
            memory_summary = get_memory_summary()

    yield _event("game_over", message="K2 failed to escape this level after 3 attempts.")
