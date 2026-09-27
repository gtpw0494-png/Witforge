"""Promotion score helper for local ForgeLM capability gates.

This scores whether a capability or model is ready to be promoted into active use.
It is intentionally conservative and local-only.
"""
from __future__ import annotations

from typing import Any


def promotion_score(evidence: dict[str, Any]) -> dict[str, Any]:
    """Return a promotion decision from a dictionary of evidence flags.

    Keys may include:
      tests, security, privacy, rollback, provenance, critic,
      performanceWithinBudget, latencyBudget, reproducible, benchmark, modelIntegrity,
      activeTrainingGuardrails, datasetIntegrity
    """
    if not isinstance(evidence, dict):
        return {"eligible": False, "score": 0.0, "reasons": ["evidence must be an object"]}

    required = [
        "tests",
        "security",
        "privacy",
        "rollback",
        "provenance",
        "critic",
        "performanceWithinBudget",
    ]

    passed = []
    reasons = []
    score = 0.0

    for key in required:
        value = bool(evidence.get(key, False))
        if value:
            passed.append(key)
            score += 1.0
        else:
            reasons.append(f"missing:{key}")

    if evidence.get("benchmark") is not None:
        score += 0.5
    if evidence.get("modelIntegrity") is True:
        score += 0.5
    if evidence.get("datasetIntegrity") is True:
        score += 0.5
    if evidence.get("activeTrainingGuardrails") is True:
        score += 0.5

    # Hard gate: without the core safety and governance checks, no promotion.
    eligible = all(bool(evidence.get(k, False)) for k in [
        "tests",
        "security",
        "privacy",
        "rollback",
        "provenance",
        "critic",
        "performanceWithinBudget",
    ])

    result = {
        "eligible": bool(eligible),
        "score": round(score, 2),
        "passed": passed,
        "reasons": reasons,
        "local_only": True,
    }
    return result


if __name__ == "__main__":
    import json

    sample = {
        "tests": True,
        "security": True,
        "privacy": True,
        "rollback": True,
        "provenance": True,
        "critic": True,
        "performanceWithinBudget": True,
        "benchmark": True,
        "modelIntegrity": True,
        "datasetIntegrity": True,
        "activeTrainingGuardrails": True,
    }
    print(json.dumps(promotion_score(sample), indent=2, sort_keys=True))


__all__ = ["promotion_score"]
