"""Navigator agent — decides the next action."""

from __future__ import annotations

from .base import K2_MODEL, get_client, SHARED_PROMPT, load_prompt

NAVIGATOR_PROMPT = SHARED_PROMPT + "\n\n" + load_prompt("navigator")


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
