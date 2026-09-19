"""
Game state management for Backrooms.
Handles room definitions, player state, and memory persistence.
"""

from __future__ import annotations

import json
from pathlib import Path

MEMORY_FILE = Path(__file__).parent / "memory.json"

# ---------------------------------------------------------------------------
# Room definitions — edit these to design levels
# ---------------------------------------------------------------------------

LEVELS: dict[int, dict] = {
    1: {
        "id": 1,
        "name": "Level 0 — The Lobby",
        "description": (
            "You find yourself in a vast, empty office space. "
            "Yellowed wallpaper peels from the walls. Fluorescent lights flicker overhead. "
            "The hum of the lights is the only sound. "
            "There are three doors: one to the north marked with a red X, "
            "one to the east that appears locked, and one to the south that is slightly ajar. "
            "On the floor near the east door, there is a crumpled note. "
            "The air smells of moist carpet and something metallic."
        ),
        "items": ["crumpled note", "flickering light fixture", "locked east door", "door to south (ajar)", "door to north (red X)"],
        "clues": {
            "crumpled note": "The note reads: 'Never go north. The code is the year this building was abandoned: 19__. Check the wall.'",
            "flickering light fixture": "You notice the light flickers in a pattern: 3 times, pause, 8 times, pause, 4 times.",
            "locked east door": "The door has a 4-digit keypad. It needs a code.",
            "door to south (ajar)": "Through the gap you see another long corridor. It seems safe.",
            "door to north (red X)": "You hear a distant sound from behind this door. Something is moving.",
        },
        "exit_condition": {
            "action": "enter code 1984 on east door keypad",
            "answer": "1984",
            "description": "The east door unlocks. You proceed to the next level."
        },
        "danger": {
            "action": "go north",
            "description": "You went north. The thing behind the door found you. You are lost in the Backrooms."
        }
    },
    2: {
        "id": 2,
        "name": "Level 1 — The Fluorescent Hum",
        "description": (
            "A seemingly infinite expanse of randomly segmented empty rooms. "
            "The carpet is a deep yellow-green. Pipes run along the ceiling. "
            "You can hear water dripping somewhere. "
            "There is a map scratched into the wall, but parts are worn away. "
            "Two corridors branch off: left corridor has a faint blue glow, "
            "right corridor smells of something burnt. "
            "A maintenance door is directly ahead, padlocked."
        ),
        "items": ["scratched map", "padlocked maintenance door", "left corridor (blue glow)", "right corridor (burnt smell)", "dripping pipe"],
        "clues": {
            "scratched map": "The map shows a path: right, right, left. But the destination is scratched out. A number is visible: 7.",
            "padlocked maintenance door": "The padlock has 3 dials, each a single digit.",
            "left corridor (blue glow)": "You follow the glow. It leads to a dead end with a piece of paper: '2'. You return safely.",
            "right corridor (burnt smell)": "You find a burnt circuit board with '4' etched into it. The smell gets stronger deeper in.",
            "dripping pipe": "The drips fall in a rhythm: 7 drops, pause, 2 drops, pause, 4 drops. It repeats.",
        },
        "exit_condition": {
            "action": "enter code 724 on padlock",
            "answer": "724",
            "description": "The padlock clicks open. You descend through the maintenance door."
        },
        "danger": {
            "action": "go deeper into right corridor",
            "description": "The burnt smell was a warning. Something collapsed. You are trapped."
        }
    },
    3: {
        "id": 3,
        "name": "Level 2 — The Pipe Dreams",
        "description": (
            "A massive concrete room filled with steam pipes and catwalks. "
            "Visibility is low due to steam venting. "
            "You can make out three catwalks: one leading up, one leading down, one leading across. "
            "On the floor you find a hard hat and a logbook. "
            "Something large is moving in the steam above you. "
            "Exit signs are visible but contradictory — two point in opposite directions."
        ),
        "items": ["hard hat", "logbook", "catwalk up", "catwalk down", "catwalk across", "contradictory exit signs"],
        "clues": {
            "hard hat": "Inside the hard hat is written: 'When signs disagree, trust the floor.'",
            "logbook": "Last entry: 'Day 47. The down catwalk leads to the reactor. Do NOT go down. Across leads to exit but you must time the steam vents — they cycle every 30 seconds. Up leads to the entity nesting area.'",
            "catwalk up": "You peer up. You see shapes moving. This is dangerous.",
            "catwalk down": "A wave of heat hits you. Definitely dangerous.",
            "catwalk across": "Steam vents periodically blast across this path. Timing is critical.",
            "contradictory exit signs": "One points up, one points across. The logbook said trust the floor — the floor arrows point across.",
        },
        "exit_condition": {
            "action": "cross the catwalk across timing the steam vents",
            "answer": "cross timing steam vents",
            "description": "You time the vents perfectly and cross. You find an exit door. You escape the Backrooms."
        },
        "danger": {
            "action": "go up or go down",
            "description": "You chose wrong. There is no coming back from this."
        }
    }
}


# ---------------------------------------------------------------------------
# Memory persistence
# ---------------------------------------------------------------------------

def load_memory() -> dict:
    if MEMORY_FILE.exists():
        return json.loads(MEMORY_FILE.read_text())
    return {"attempts": []}


def save_memory(memory: dict) -> None:
    MEMORY_FILE.write_text(json.dumps(memory, indent=2))


def record_attempt(level_id: int, action: str, result: str, reason: str) -> None:
    memory = load_memory()
    memory["attempts"].append({
        "level": level_id,
        "action": action,
        "result": result,
        "reason": reason,
    })
    save_memory(memory)


def clear_memory() -> None:
    save_memory({"attempts": []})


def get_memory_summary() -> str:
    memory = load_memory()
    if not memory["attempts"]:
        return "No previous attempts recorded."
    lines = []
    for a in memory["attempts"]:
        lines.append(f"Level {a['level']}: tried '{a['action']}' → {a['result']} ({a['reason']})")
    return "\n".join(lines)
