"""Shared K2 client for all agents."""

from __future__ import annotations

import json
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv()

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def load_prompt(name: str) -> str:
    """Load a prompt file from the prompts/ directory (without .txt)."""
    return (PROMPTS_DIR / f"{name}.txt").read_text().strip()


SHARED_PROMPT = load_prompt("shared")

K2_API_KEY = os.getenv("K2_API_KEY", "")
K2_BASE_URL = os.getenv("K2_BASE_URL", "https://api.ifm.ai/v1")
K2_MODEL = os.getenv("K2_MODEL", "IFM/K2-Horizon-375B-A23B")

_client: AsyncOpenAI | None = None


def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=K2_API_KEY, base_url=K2_BASE_URL)
    return _client


def sse_event(kind: str, **payload) -> str:
    return "data: " + json.dumps({"type": kind, **payload}) + "\n\n"
