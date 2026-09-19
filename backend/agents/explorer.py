"""Explorer agent — observes the room and finds clues."""

from __future__ import annotations

from .base import K2_MODEL, get_client, SHARED_PROMPT, load_prompt

EXPLORER_PROMPT = SHARED_PROMPT + "\n\n" + load_prompt("explorer")


async def call_explorer(room: dict) -> str:
    client = get_client()
    r = await client.chat.completions.create(
        model=K2_MODEL,
        messages=[
            {"role": "system", "content": EXPLORER_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Room: {room['name']}\n\n"
                    f"{room['description']}\n\n"
                    f"Items present: {', '.join(room['items'])}"
                ),
            },
        ],
    )
    return r.choices[0].message.content
