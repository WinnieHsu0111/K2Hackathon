"""Explorer agent — observes the room and finds clues."""

from __future__ import annotations

import textwrap

from .base import K2_MODEL, get_client

EXPLORER_PROMPT = textwrap.dedent("""
You are the Explorer agent in a Backrooms survival game.
Your job: carefully observe the environment and identify ALL clues and items.
Be methodical. List every object, sound, smell, and visual detail.
Do NOT make decisions or recommendations — only report what you observe.
Format your response as a clear list of observations.
""").strip()


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
