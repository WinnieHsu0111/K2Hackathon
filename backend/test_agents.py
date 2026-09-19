"""
Quick test runner for prompt engineering.
Run: uv run python test_agents.py
"""

import asyncio
from game_state import LEVELS
from agents.explorer import call_explorer
from agents.survival import call_survival
from agents.navigator import call_navigator
from agents.supervisor import judge_action
from game_state import get_memory_summary

LEVEL_ID = 1  # change this to test different levels

SEP = "-" * 60


async def main():
    room = LEVELS[LEVEL_ID]
    print(f"\n{'='*60}")
    print(f"LEVEL {LEVEL_ID}: {room['name']}")
    print(f"{'='*60}")
    print(room["description"])
    print()

    memory = get_memory_summary()
    if memory != "No previous attempts recorded.":
        print(f"[MEMORY]\n{memory}\n")

    # Explorer
    print(f"{SEP}\n[EXPLORER] Scanning environment...\n{SEP}")
    explorer_output = await call_explorer(room)
    print(explorer_output)

    # Survival
    print(f"\n{SEP}\n[SURVIVAL] Assessing dangers...\n{SEP}")
    survival_output = await call_survival(room, explorer_output)
    print(survival_output)

    # Navigator
    print(f"\n{SEP}\n[NAVIGATOR] Deciding action...\n{SEP}")
    navigator_output = await call_navigator(room, explorer_output, survival_output, memory)
    print(navigator_output)

    # Extract action
    action = navigator_output
    if "ACTION:" in navigator_output:
        action = navigator_output.split("ACTION:")[1].split("\n")[0].strip()
    print(f"\n>>> ACTION TAKEN: {action}")

    # Supervisor judges
    print(f"\n{SEP}\n[SUPERVISOR] Judging action...\n{SEP}")
    verdict, reason = await judge_action(action, room)
    print(f"VERDICT: {verdict}")
    print(f"REASON:  {reason}")

    print(f"\n{'='*60}")
    if verdict == "SUCCESS":
        print(f"✓ LEVEL COMPLETE: {room['exit_condition']['description']}")
    elif verdict == "DANGER":
        print(f"✗ DEATH: {room['danger']['description']}")
    else:
        print("~ NO PROGRESS — tweak the prompts and try again")
    print(f"{'='*60}\n")


asyncio.run(main())
