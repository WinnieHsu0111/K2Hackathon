"""
K2Hackathon agent core.

The K2 Horizon LLM is the "brain"; Python tools are the execution layer.
When K2_API_KEY is empty the agent runs in MOCK mode – it replays a
realistic scripted conversation so the full UI can be developed offline.
"""

from __future__ import annotations

import json
import os
import textwrap
from typing import Any, AsyncGenerator

from dotenv import load_dotenv
from openai import AsyncOpenAI

from tools import TOOL_CALLABLES, TOOL_SCHEMAS

load_dotenv()

# ---------------------------------------------------------------------------
# LLM client (swap K2 in by setting env vars)
# ---------------------------------------------------------------------------

K2_API_KEY = os.getenv("K2_API_KEY", "")
K2_BASE_URL = os.getenv("K2_BASE_URL", "https://api.placeholder.ifm.ai/v1")
K2_MODEL = os.getenv("K2_MODEL", "IFM/K2-Horizon-375B-A23B")

MOCK_MODE = not K2_API_KEY

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=K2_API_KEY or "mock", base_url=K2_BASE_URL)
    return _client


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = textwrap.dedent("""
You are K2Hackathon, an expert scientific-reproducibility agent.

Your task:
1. Read the provided paper text to identify the main statistical claim/result
   (e.g. an odds ratio, regression coefficient, p-value, mean difference).
2. Inspect the provided dataset to understand its structure.
3. Extract the statistical method, outcome variable, predictors, and any
   inclusion/exclusion criteria described in the paper.
4. Execute the analysis using the available tools.
5. Compare your reproduced result to the paper's reported result.
6. If results diverge, investigate (e.g. check filters, variable coding,
   confounders) and revise the analysis.
7. Return a final verdict with:
   - paper_result: the value as reported
   - reproduced_result: your computed value
   - direction_match: bool
   - significance_match: bool
   - effect_size_within_tolerance: bool (within 10% relative error)
   - reproducibility_score: integer 0-100
   - verdict: "Reproduced" | "Partially Reproduced" | "Not Reproduced"
   - explanation: 2-3 sentence plain-English summary

Think step by step. Use tools whenever you need to inspect data or run
statistics — never guess numerical results.
""").strip()


# ---------------------------------------------------------------------------
# Event streaming helpers
# ---------------------------------------------------------------------------

def _event(kind: str, **payload) -> str:
    """Format a server-sent event line."""
    return "data: " + json.dumps({"type": kind, **payload}) + "\n\n"


# ---------------------------------------------------------------------------
# Mock mode – scripted replay for UI development
# ---------------------------------------------------------------------------

MOCK_STEPS = [
    ("reading_paper",    "Reading methods section and identifying main statistical claim…"),
    ("inspecting_data",  "Inspecting dataset structure, columns, and missing values…"),
    ("extracting_method","Extracting outcome variable, predictors, and inclusion criteria…"),
    ("building_model",   "Building logistic regression model (initial attempt)…"),
    ("running_analysis", "Running analysis — first pass…"),
    ("checking_discrepancy", "Result diverges from paper (OR 1.51 vs 1.72). Investigating…"),
    ("revising_analysis","Found missing inclusion criterion: age ≥ 18. Applying filter and re-running…"),
    ("final_analysis",   "Re-running corrected model…"),
]

MOCK_RESULT = {
    "paper_result": "OR = 1.72 (95% CI: 1.41–2.09), p < 0.001",
    "reproduced_result": "OR = 1.69 (95% CI: 1.38–2.06), p < 0.001",
    "paper_value": 1.72,
    "reproduced_value": 1.69,
    "direction_match": True,
    "significance_match": True,
    "effect_size_within_tolerance": True,
    "reproducibility_score": 94,
    "verdict": "Reproduced",
    "explanation": (
        "The main claim — a significant positive association between the exposure "
        "and outcome (OR ≈ 1.72) — was successfully reproduced after applying the "
        "paper's age-≥18 inclusion criterion. The reproduced OR of 1.69 is within "
        "2% of the reported value, and statistical significance is preserved."
    ),
}


async def _mock_stream(paper_text: str, csv_bytes: bytes) -> AsyncGenerator[str, None]:
    import asyncio
    yield _event("mode", value="mock")
    yield _event("status", message="Running in mock mode (no K2 API key configured)")

    for step_id, message in MOCK_STEPS:
        yield _event("step", step=step_id, message=message)
        await asyncio.sleep(0.9)

    yield _event("tool_call", tool="run_logistic_regression",
                 args={"outcome": "event", "predictors": ["exposure", "age", "sex"]})
    await asyncio.sleep(0.5)
    yield _event("tool_result", tool="run_logistic_regression",
                 result={"model": "Logistic Regression", "n_obs": 1247,
                         "coefficients": {"exposure": {"odds_ratio": 1.51}}})
    await asyncio.sleep(0.4)
    yield _event("tool_call", tool="filter_rows",
                 args={"conditions": [{"column": "age", "operator": ">=", "value": 18}]})
    await asyncio.sleep(0.5)
    yield _event("tool_result", tool="filter_rows",
                 result={"original_rows": 1247, "filtered_rows": 1183, "removed_rows": 64})
    await asyncio.sleep(0.4)
    yield _event("tool_call", tool="run_logistic_regression",
                 args={"outcome": "event", "predictors": ["exposure", "age", "sex"],
                       "conditions": [{"column": "age", "operator": ">=", "value": 18}]})
    await asyncio.sleep(0.7)
    yield _event("tool_result", tool="run_logistic_regression",
                 result={"model": "Logistic Regression", "n_obs": 1183,
                         "coefficients": {"exposure": {"odds_ratio": 1.69}}})
    await asyncio.sleep(0.3)
    yield _event("result", **MOCK_RESULT)
    yield _event("done")


# ---------------------------------------------------------------------------
# Live mode – real agentic loop with K2
# ---------------------------------------------------------------------------

async def _live_stream(paper_text: str, csv_bytes: bytes) -> AsyncGenerator[str, None]:
    messages: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Here is the paper text (may be truncated):\n\n{paper_text}\n\n"
                "Please reproduce the main statistical result using the tools available."
            ),
        },
    ]

    yield _event("mode", value="live")
    client = _get_client()
    max_iterations = 8

    for iteration in range(max_iterations):
        response = await client.chat.completions.create(
            model=K2_MODEL,
            messages=messages,
            tools=TOOL_SCHEMAS,
            tool_choice="auto",
            stream=False,
        )
        msg = response.choices[0].message

        # Stream any text the model produced
        if msg.content:
            yield _event("step", step=f"thinking_{iteration}", message=msg.content)

        # No tool calls → model is done
        if not msg.tool_calls:
            # Try to parse the final verdict from the message
            try:
                verdict = json.loads(msg.content)
            except Exception:
                verdict = {"explanation": msg.content or "Analysis complete.", "verdict": "See explanation"}
            yield _event("result", **verdict)
            break

        # Execute tool calls
        messages.append(msg.model_dump(exclude_unset=True))
        tool_results = []
        for tc in msg.tool_calls:
            fn_name = tc.function.name
            fn_args = json.loads(tc.function.arguments)

            yield _event("tool_call", tool=fn_name, args=fn_args)

            # Inject csv_bytes into the call
            fn_args["csv_bytes"] = csv_bytes
            callable_fn = TOOL_CALLABLES.get(fn_name)
            if callable_fn is None:
                result = {"error": f"Unknown tool: {fn_name}"}
            else:
                try:
                    result = callable_fn(**fn_args)
                    # Remove internal _filtered_csv key before sending to LLM
                    result.pop("_filtered_csv", None)
                except Exception as e:
                    result = {"error": str(e)}

            yield _event("tool_result", tool=fn_name, result=result)
            tool_results.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": json.dumps(result),
            })

        messages.extend(tool_results)
    else:
        yield _event("step", step="timeout", message="Max iterations reached.")
        yield _event("result", verdict="Incomplete", explanation="Agent reached maximum iterations.")

    yield _event("done")


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def run_agent(paper_bytes: bytes, csv_bytes: bytes) -> AsyncGenerator[str, None]:
    """
    Main entry point.  Yields SSE-formatted strings.
    Callers should stream these directly to the client.
    """
    from tools import extract_pdf_text

    pdf_info = extract_pdf_text(paper_bytes)
    paper_text = "\n\n".join(
        f"[Page {p['page']}]\n{p['text']}" for p in pdf_info["pages"]
    )

    if MOCK_MODE:
        async for event in _mock_stream(paper_text, csv_bytes):
            yield event
    else:
        async for event in _live_stream(paper_text, csv_bytes):
            yield event
