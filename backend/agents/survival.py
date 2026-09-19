"""Survival agent — assesses dangers in the room."""

from __future__ import annotations

import textwrap

from .base import K2_MODEL, get_client

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


async def call_survival(room: dict, explorer_output: str) -> str:
    client = get_client()
    r = await client.chat.completions.create(
        model=K2_MODEL,
        messages=[
            {"role": "system", "content": SURVIVAL_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Room: {room['name']}\n\n"
                    f"Explorer's observations:\n{explorer_output}"
                ),
            },
        ],
    )
    return r.choices[0].message.content
