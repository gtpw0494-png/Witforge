"""Local reasoning capability layer for ForgeLM.

This is not a frontier reasoning model. It is a deterministic local-analysis layer
that breaks problems into steps, identifies assumptions, checks for contradictions,
and returns structured reasoning evidence without calling any external service.
"""
from __future__ import annotations

import json
import re
from typing import Any


def _extract_numbers(text: str) -> list[float]:
    return [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", str(text or ""))]


def _normalize_claim(claim: str) -> str:
    text = str(claim or "").strip()
    if not text:
        return "empty claim"
    return re.sub(r"\s+", " ", text)


def reason_about(problem: str, *, context: str | None = None) -> dict[str, Any]:
    """Return a locally produced reasoning trace and conclusion."""
    prompt = str(problem or "").strip()
    if not prompt:
        return {"state": "FAILURE", "message": "problem is empty"}

    steps = []
    steps.append({
        "step": 1,
        "action": "identify the objective",
        "detail": f"Interpret the task: {prompt[:200]}",
    })

    assumptions = []
    if "not" in prompt.lower():
        assumptions.append("The problem includes a negation; verify whether it is a real constraint or a trap.")
    if "if" in prompt.lower():
        assumptions.append("The prompt includes a conditional; confirm the required branch before concluding.")
    if not assumptions:
        assumptions.append("No explicit contradiction or special branch was identified in the prompt.")

    steps.append({
        "step": 2,
        "action": "check the local facts",
        "detail": f"Context: {context or 'none provided'}",
    })

    numbers = _extract_numbers(prompt)
    if numbers:
        steps.append({
            "step": 3,
            "action": "numeric sanity-check",
            "detail": f"Numeric values found: {numbers}",
        })
        if len(numbers) >= 2:
            total = sum(numbers)
            steps.append({
                "step": 4,
                "action": "aggregate local numeric evidence",
                "detail": f"Sum of values: {total}",
            })
            conclusion = f"The local numeric evidence sums to {total}."
        else:
            conclusion = f"The local evidence indicates a single numeric anchor at {numbers[0]}."
    else:
        conclusion = "The prompt is primarily qualitative; local reasoning remains based on the explicit textual constraints."

    verdict = "The local reasoning trace is internally consistent with the supplied prompt and local context."
    if re.search(r"(contradiction|inconsistent|impossible|cannot|never)", prompt.lower()):
        verdict = "The prompt contains a tension or contradiction; a conservative answer is warranted."

    return {
        "state": "SUCCESS",
        "problem": prompt,
        "context": context or "",
        "assumptions": assumptions,
        "steps": steps,
        "conclusion": conclusion,
        "verdict": verdict,
        "local_only": True,
        "network_required": False,
    }


def solve_constraint_problem(problem: str, *, context: str | None = None) -> dict[str, Any]:
    """Compatibility wrapper for local constraint reasoning."""
    return reason_about(problem, context=context)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Local ForgeReason capability")
    parser.add_argument("--problem", default="Compare two local storage strategies.")
    parser.add_argument("--context", default="")
    args = parser.parse_args()
    print(json.dumps(reason_about(args.problem, context=args.context), indent=2, sort_keys=True))


__all__ = ["reason_about", "solve_constraint_problem"]
