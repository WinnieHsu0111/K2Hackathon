"""
Decision loop for K2-plays-the-game mode.

Takes the frontend's live game state and streams the multi-agent reasoning,
ending with a high-level DECISION (intent) the frontend executes via BFS.
"""

from __future__ import annotations

import json
import textwrap
from typing import AsyncGenerator

from pydantic import BaseModel

from .base import K2_MODEL, get_client, sse_event, SHARED_PROMPT

VALID_INTENTS = ["GO_KEY", "GO_LOCK", "GO_DOCUMENT", "ANSWER", "GO_SAFE", "GO_EXIT"]


class GameState(BaseModel):
    hasKey: bool = False
    lockOpen: bool = False
    gateOpen: bool = False
    documentAnswered: bool = False
    monsterActive: bool = False
    playerInSafeZone: bool = False
    monsterState: str = "PATROL"
    playerTile: dict = {"x": 0, "y": 0}
    monsterTile: dict = {"x": 0, "y": 0}
    question: dict | None = None


DECIDER_PROMPT = SHARED_PROMPT + "\n\n" + textwrap.dedent("""
You are the Navigator deciding the character's next high-level intent in a
Backrooms escape game. You control the player by choosing ONE intent; the game
engine handles the actual movement via pathfinding.

Available intents:
- GO_KEY: walk to and pick up the key (needed before the code door)
- GO_LOCK: walk to the code door and open it (requires the key)
- GO_DOCUMENT: walk to the document to read the puzzle
- ANSWER: answer the puzzle (provide answerId: A, B, or C)
- GO_SAFE: flee to the nearest safe zone (use when the monster is chasing)
- GO_EXIT: walk to the final exit (only after the gate is open)

Decision priorities:
1. If the monster is actively chasing and you are NOT in a safe zone → GO_SAFE
2. If you don't have the key yet → GO_KEY
3. If you have the key but the code door is not open → GO_LOCK
4. If the door is open but the puzzle isn't answered → GO_DOCUMENT, then ANSWER
5. If the gate is open and puzzle answered → GO_EXIT

When choosing ANSWER, use the puzzle rule to deduce which option is the anomaly.

Respond ONLY with valid JSON:
{
  "intent": "<one of the intents>",
  "answerId": "<A/B/C, or null if intent is not ANSWER>",
  "reasoning": "<one sentence explaining why>"
}
""").strip()


def _state_summary(state: GameState) -> str:
    lines = [
        f"Has key: {state.hasKey}",
        f"Code door open: {state.lockOpen}",
        f"Gate open: {state.gateOpen}",
        f"Puzzle answered: {state.documentAnswered}",
        f"Monster active: {state.monsterActive} (state: {state.monsterState})",
        f"Player in safe zone: {state.playerInSafeZone}",
        f"Player position: {state.playerTile}",
        f"Monster position: {state.monsterTile}",
    ]
    if state.question:
        lines.append(f"Puzzle rule: {state.question.get('rule', 'unknown')}")
        opts = state.question.get("options", [])
        lines.append("Options: " + ", ".join(f"{o['id']}={o['value']}" for o in opts))
    return "\n".join(lines)


async def decide(state: GameState) -> AsyncGenerator[str, None]:
    client = get_client()
    summary = _state_summary(state)

    yield sse_event("agent_thinking", agent="Navigator", message="Reading game state...")

    r = await client.chat.completions.create(
        model=K2_MODEL,
        messages=[
            {"role": "system", "content": DECIDER_PROMPT},
            {"role": "user", "content": f"Current game state:\n{summary}\n\nDecide the next intent."},
        ],
    )
    content = r.choices[0].message.content.strip()

    # Strip markdown fences
    if content.startswith("```"):
        content = content.split("```")[1]
        if content.startswith("json"):
            content = content[4:]
    content = content.strip()

    try:
        decision = json.loads(content)
    except Exception:
        decision = {"intent": "GO_KEY", "answerId": None, "reasoning": "Fallback: could not parse decision."}

    intent = decision.get("intent", "GO_KEY")
    if intent not in VALID_INTENTS:
        intent = "GO_KEY"

    yield sse_event(
        "decision",
        intent=intent,
        answerId=decision.get("answerId"),
        reasoning=decision.get("reasoning", ""),
    )
