"""Survival agent — assesses dangers in the room."""

from __future__ import annotations

from .base import K2_MODEL, get_client, SHARED_PROMPT, load_prompt

SURVIVAL_PROMPT = SHARED_PROMPT + "\n\n" + load_prompt("survival")


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
