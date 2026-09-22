"""Side-by-side comparison: K2 Horizon vs a small baseline model.

Both models receive the SAME game state and the SAME Supervisor prompt, then
each returns a decision. This makes the "why K2" claim concrete: judges/viewers
see, on identical inputs, how the larger reasoning model's choice differs from a
small model's. We report both verbatim — no cherry-picking.
"""

from __future__ import annotations

import json
import time
from typing import AsyncGenerator

from .base import (
    K2_MODEL,
    BASELINE_MODEL,
    get_client,
    get_baseline_client,
    sse_event,
)
from .decide import (
    GameState,
    _state_summary,
    _parse_decision,
    VALID_INTENTS,
    SUPERVISOR_GAME,
)


def _build_prompt(state: GameState) -> tuple[str, str]:
    """The system + user prompt both models see (identical for fairness)."""
    summary = _state_summary(state)
    if state.question:
        summary += "\nThe document is open. Return ANSWER with answerId A, B, or C."
    user = (
        f"Current game state:\n{summary}\n\n"
        "Decide the single best next intent for the player and return ONLY compact "
        'JSON: {"intent": "<one valid intent>", "answerId": "<A/B/C or null>", '
        '"reasoning": "<one sentence>"}'
    )
    return SUPERVISOR_GAME, user


async def _one_model(client, model: str, system: str, user: str, state: GameState) -> dict:
    started = time.monotonic()
    try:
        r = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        content = r.choices[0].message.content or ""
        decision = _parse_decision(content, state)
        valid = isinstance(decision, dict) and decision.get("intent") in VALID_INTENTS
        return {
            "intent": decision.get("intent") if valid else "(invalid)",
            "answerId": decision.get("answerId"),
            "reasoning": decision.get("reasoning", "")[:400],
            "valid": valid,
            "elapsedSeconds": round(time.monotonic() - started, 2),
            "raw": content[:600],
        }
    except Exception as e:  # surface, don't crash the comparison
        return {
            "intent": "(error)",
            "answerId": None,
            "reasoning": f"{type(e).__name__}: {str(e)[:200]}",
            "valid": False,
            "elapsedSeconds": round(time.monotonic() - started, 2),
            "raw": "",
        }


async def compare(state: GameState) -> AsyncGenerator[str, None]:
    """Run K2 and the baseline on identical input; stream both results."""
    system, user = _build_prompt(state)

    yield sse_event("compare_thinking", model="K2 Horizon", label=K2_MODEL,
                    message="Reasoning over the game state...")
    k2 = await _one_model(get_client(), K2_MODEL, system, user, state)
    yield sse_event("compare_result", model="K2 Horizon", label=K2_MODEL, **k2)

    yield sse_event("compare_thinking", model="Baseline", label=BASELINE_MODEL,
                    message="Small model reasoning over the same state...")
    base = await _one_model(get_baseline_client(), BASELINE_MODEL, system, user, state)
    yield sse_event("compare_result", model="Baseline", label=BASELINE_MODEL, **base)

    yield sse_event("compare_done",
                    k2_intent=k2["intent"], baseline_intent=base["intent"],
                    agree=(k2["intent"] == base["intent"]))
