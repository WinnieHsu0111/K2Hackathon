"""
Statistical and data-inspection tools called by the K2Hackathon agent.
Each function returns a plain dict so it can be serialised to JSON and
sent back to the LLM as a tool result.
"""

from __future__ import annotations

import io
import json
import textwrap
from pathlib import Path
from typing import Any

import pymupdf as fitz
import numpy as np
import pandas as pd
import scipy.stats as stats
import statsmodels.api as sm
import statsmodels.formula.api as smf


# ---------------------------------------------------------------------------
# PDF tools
# ---------------------------------------------------------------------------

def extract_pdf_text(pdf_bytes: bytes, max_chars: int = 40_000) -> dict:
    """Extract text from a PDF; truncate to avoid flooding the context."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    num_pages = doc.page_count
    pages = []
    total = 0
    for i, page in enumerate(doc):
        text = page.get_text()
        pages.append({"page": i + 1, "text": text})
        total += len(text)
        if total >= max_chars:
            pages[-1]["text"] = pages[-1]["text"][: max_chars - (total - len(text))]
            pages[-1]["truncated"] = True
            break
    doc.close()
    return {"num_pages": num_pages, "pages": pages, "total_chars": min(total, max_chars)}


# ---------------------------------------------------------------------------
# CSV / DataFrame tools
# ---------------------------------------------------------------------------

def inspect_dataset(csv_bytes: bytes) -> dict:
    """Return shape, dtypes, summary stats, and first 5 rows of a CSV."""
    df = pd.read_csv(io.BytesIO(csv_bytes))
    return {
        "rows": len(df),
        "columns": len(df.columns),
        "column_names": df.columns.tolist(),
        "dtypes": df.dtypes.astype(str).to_dict(),
        "missing_counts": df.isnull().sum().to_dict(),
        "describe": json.loads(df.describe(include="all").to_json()),
        "head": json.loads(df.head(5).to_json(orient="records")),
    }


def filter_rows(csv_bytes: bytes, conditions: list[dict]) -> dict:
    """
    Apply inclusion/exclusion filters.
    Each condition: {"column": str, "operator": "<"|">"|"=="|"!="| "in"|"not_in", "value": ...}
    Returns stats on the filtered frame.
    """
    df = pd.read_csv(io.BytesIO(csv_bytes))
    original_n = len(df)
    for cond in conditions:
        col, op, val = cond["column"], cond["operator"], cond["value"]
        if col not in df.columns:
            return {"error": f"Column '{col}' not found"}
        if op == "<":
            df = df[df[col] < val]
        elif op == ">":
            df = df[df[col] > val]
        elif op == "==":
            df = df[df[col] == val]
        elif op == "!=":
            df = df[df[col] != val]
        elif op == "in":
            df = df[df[col].isin(val)]
        elif op == "not_in":
            df = df[~df[col].isin(val)]
    return {
        "original_rows": original_n,
        "filtered_rows": len(df),
        "removed_rows": original_n - len(df),
        "column_names": df.columns.tolist(),
        "head": json.loads(df.head(5).to_json(orient="records")),
        "_filtered_csv": df.to_csv(index=False),  # passed internally, not shown to user
    }


# ---------------------------------------------------------------------------
# Statistical analysis tools
# ---------------------------------------------------------------------------

def run_descriptive_stats(csv_bytes: bytes, columns: list[str] | None = None) -> dict:
    df = pd.read_csv(io.BytesIO(csv_bytes))
    if columns:
        df = df[[c for c in columns if c in df.columns]]
    desc = df.describe(include="all")
    return {"describe": json.loads(desc.to_json())}


def run_linear_regression(
    csv_bytes: bytes,
    outcome: str,
    predictors: list[str],
    conditions: list[dict] | None = None,
) -> dict:
    df = pd.read_csv(io.BytesIO(csv_bytes))
    if conditions:
        res = filter_rows(csv_bytes, conditions)
        df = pd.read_csv(io.StringIO(res["_filtered_csv"]))

    missing = [c for c in [outcome] + predictors if c not in df.columns]
    if missing:
        return {"error": f"Columns not found: {missing}"}

    df = df[[outcome] + predictors].dropna()
    formula = f"{outcome} ~ " + " + ".join(predictors)
    model = smf.ols(formula, data=df).fit()

    coefs = {}
    for name in model.params.index:
        coefs[name] = {
            "estimate": round(float(model.params[name]), 4),
            "std_err": round(float(model.bse[name]), 4),
            "t_stat": round(float(model.tvalues[name]), 4),
            "p_value": round(float(model.pvalues[name]), 4),
            "ci_lower": round(float(model.conf_int().loc[name, 0]), 4),
            "ci_upper": round(float(model.conf_int().loc[name, 1]), 4),
        }

    return {
        "model": "OLS Linear Regression",
        "formula": formula,
        "n_obs": int(model.nobs),
        "r_squared": round(float(model.rsquared), 4),
        "adj_r_squared": round(float(model.rsquared_adj), 4),
        "f_stat": round(float(model.fvalue), 4),
        "f_pvalue": round(float(model.f_pvalue), 4),
        "coefficients": coefs,
    }


def run_logistic_regression(
    csv_bytes: bytes,
    outcome: str,
    predictors: list[str],
    conditions: list[dict] | None = None,
    report_or: bool = True,
) -> dict:
    df = pd.read_csv(io.BytesIO(csv_bytes))
    if conditions:
        res = filter_rows(csv_bytes, conditions)
        df = pd.read_csv(io.StringIO(res["_filtered_csv"]))

    missing = [c for c in [outcome] + predictors if c not in df.columns]
    if missing:
        return {"error": f"Columns not found: {missing}"}

    df = df[[outcome] + predictors].dropna()
    formula = f"{outcome} ~ " + " + ".join(predictors)
    model = smf.logit(formula, data=df).fit(disp=False)

    coefs = {}
    ci = model.conf_int()
    for name in model.params.index:
        entry: dict[str, Any] = {
            "log_odds": round(float(model.params[name]), 4),
            "std_err": round(float(model.bse[name]), 4),
            "z_stat": round(float(model.tvalues[name]), 4),
            "p_value": round(float(model.pvalues[name]), 4),
        }
        if report_or:
            entry["odds_ratio"] = round(float(np.exp(model.params[name])), 4)
            entry["or_ci_lower"] = round(float(np.exp(ci.loc[name, 0])), 4)
            entry["or_ci_upper"] = round(float(np.exp(ci.loc[name, 1])), 4)
        coefs[name] = entry

    return {
        "model": "Logistic Regression",
        "formula": formula,
        "n_obs": int(model.nobs),
        "log_likelihood": round(float(model.llf), 4),
        "aic": round(float(model.aic), 4),
        "pseudo_r2_mcfadden": round(float(model.prsquared), 4),
        "coefficients": coefs,
    }


def run_ttest(
    csv_bytes: bytes,
    variable: str,
    group_col: str,
    group_a: Any,
    group_b: Any,
) -> dict:
    df = pd.read_csv(io.BytesIO(csv_bytes))
    a = df[df[group_col] == group_a][variable].dropna()
    b = df[df[group_col] == group_b][variable].dropna()
    stat, p = stats.ttest_ind(a, b)
    return {
        "model": "Independent t-test",
        "variable": variable,
        "group_a": {"label": str(group_a), "n": len(a), "mean": round(float(a.mean()), 4)},
        "group_b": {"label": str(group_b), "n": len(b), "mean": round(float(b.mean()), 4)},
        "t_statistic": round(float(stat), 4),
        "p_value": round(float(p), 4),
        "significant_at_05": bool(p < 0.05),
    }


def run_chi_square(csv_bytes: bytes, row_var: str, col_var: str) -> dict:
    df = pd.read_csv(io.BytesIO(csv_bytes))
    ct = pd.crosstab(df[row_var], df[col_var])
    chi2, p, dof, expected = stats.chi2_contingency(ct)
    return {
        "model": "Chi-square test of independence",
        "row_variable": row_var,
        "col_variable": col_var,
        "chi2_statistic": round(float(chi2), 4),
        "p_value": round(float(p), 4),
        "degrees_of_freedom": int(dof),
        "significant_at_05": bool(p < 0.05),
        "contingency_table": json.loads(ct.to_json()),
    }


# ---------------------------------------------------------------------------
# Tool registry (used by agent.py to build the tools list for the LLM)
# ---------------------------------------------------------------------------

TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "inspect_dataset",
            "description": "Inspect a CSV dataset: shape, dtypes, missing values, summary statistics, and first rows.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "filter_rows",
            "description": "Apply inclusion/exclusion criteria to filter dataset rows before analysis.",
            "parameters": {
                "type": "object",
                "properties": {
                    "conditions": {
                        "type": "array",
                        "description": "List of filter conditions.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "column": {"type": "string"},
                                "operator": {"type": "string", "enum": ["<", ">", "==", "!=", "in", "not_in"]},
                                "value": {},
                            },
                            "required": ["column", "operator", "value"],
                        },
                    }
                },
                "required": ["conditions"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_descriptive_stats",
            "description": "Compute descriptive statistics for selected columns.",
            "parameters": {
                "type": "object",
                "properties": {
                    "columns": {"type": "array", "items": {"type": "string"}},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_linear_regression",
            "description": "Run OLS linear regression. Returns coefficients, R², F-stat.",
            "parameters": {
                "type": "object",
                "properties": {
                    "outcome": {"type": "string"},
                    "predictors": {"type": "array", "items": {"type": "string"}},
                    "conditions": {
                        "type": "array",
                        "items": {"type": "object"},
                        "description": "Optional row filters.",
                    },
                },
                "required": ["outcome", "predictors"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_logistic_regression",
            "description": "Run logistic regression. Returns log-odds, odds ratios, and confidence intervals.",
            "parameters": {
                "type": "object",
                "properties": {
                    "outcome": {"type": "string"},
                    "predictors": {"type": "array", "items": {"type": "string"}},
                    "conditions": {
                        "type": "array",
                        "items": {"type": "object"},
                        "description": "Optional row filters.",
                    },
                    "report_or": {"type": "boolean", "description": "Report odds ratios (default true)."},
                },
                "required": ["outcome", "predictors"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_ttest",
            "description": "Run an independent-samples t-test comparing two groups.",
            "parameters": {
                "type": "object",
                "properties": {
                    "variable": {"type": "string"},
                    "group_col": {"type": "string"},
                    "group_a": {},
                    "group_b": {},
                },
                "required": ["variable", "group_col", "group_a", "group_b"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_chi_square",
            "description": "Run a chi-square test of independence between two categorical variables.",
            "parameters": {
                "type": "object",
                "properties": {
                    "row_var": {"type": "string"},
                    "col_var": {"type": "string"},
                },
                "required": ["row_var", "col_var"],
            },
        },
    },
]

# Map tool name -> callable (csv_bytes will be injected by agent.py)
TOOL_CALLABLES = {
    "inspect_dataset": inspect_dataset,
    "filter_rows": filter_rows,
    "run_descriptive_stats": run_descriptive_stats,
    "run_linear_regression": run_linear_regression,
    "run_logistic_regression": run_logistic_regression,
    "run_ttest": run_ttest,
    "run_chi_square": run_chi_square,
}
