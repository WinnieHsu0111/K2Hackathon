"""Navigator agent — decides the next action."""

from __future__ import annotations

import textwrap

from .base import K2_MODEL, get_client

NAVIGATOR_PROMPT = textwrap.dedent("""
You are the Navigator agent in a Backrooms survival game.
Your job: decide the single best action to take right now.
You will receive:
- Explorer's observations
- Survival's risk assessment
- Memory of past failures

Based on all this, choose ONE specific action and explain your reasoning.
Your action must be concrete and specific (e.g. "read the crumpled note", "enter code 1984 on the keypad").

Format your response EXACTLY like this:
ACTION: <your chosen action>
REASONING: <why>
""").strip()


async def call_navigator(
    room: dict,
    explorer_output: str,
    survival_output: str,
    memory: str,
) -> str:
    client = get_client()
    r = await client.chat.completions.create(
        model=K2_MODEL,
        messages=[
            {"role": "system", "content": NAVIGATOR_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Room: {room['name']}\n\n"
                    f"Explorer's observations:\n{explorer_output}\n\n"
                    f"Survival assessment:\n{survival_output}\n\n"
                    f"Memory of past failures:\n{memory}"
                ),
            },
        ],
    )
    return r.choices[0].message.content
