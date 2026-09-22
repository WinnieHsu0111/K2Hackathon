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

# Baseline model for the "why K2" comparison: a small local model served by
# Ollama (OpenAI-compatible). A 1B model is weak enough that, on long-horizon
# tasks, the gap versus K2 Horizon is visible. Same inputs, so the test is fair.
BASELINE_API_KEY = os.getenv("OLLAMA_API_KEY", "ollama")
BASELINE_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
BASELINE_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:1b")

_client: AsyncOpenAI | None = None
_baseline_client: AsyncOpenAI | None = None


def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=K2_API_KEY, base_url=K2_BASE_URL)
    return _client


def get_baseline_client() -> AsyncOpenAI:
    """Small local baseline model (Ollama) used only for the side-by-side comparison."""
    global _baseline_client
    if _baseline_client is None:
        _baseline_client = AsyncOpenAI(api_key=BASELINE_API_KEY, base_url=BASELINE_BASE_URL)
    return _baseline_client


def sse_event(kind: str, **payload) -> str:
    return "data: " + json.dumps({"type": kind, **payload}) + "\n\n"
