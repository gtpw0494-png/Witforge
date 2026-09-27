"""Local code capability layer for ForgeLM.

This module provides deterministic, local-only code-oriented behavior without
calling any external model or network endpoint. It is intentionally pragmatic:
it helps UAI inspect, generate, and repair code in a governed, auditable way.
"""
from __future__ import annotations

import ast
import json
import re
from pathlib import Path
from typing import Any


def _strip_markdown_fence(text: str) -> str:
    if not isinstance(text, str):
        return ""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
    return text.strip()


def inspect_python_module(source: str) -> dict[str, Any]:
    """Return a lightweight structural summary for a Python file."""
    text = str(source or "")
    try:
        tree = ast.parse(text)
    except SyntaxError as exc:
        return {
            "state": "FAILURE",
            "error": "syntax-error",
            "line": exc.lineno,
            "offset": exc.offset,
            "message": exc.msg,
        }

    imports = []
    functions = []
    classes = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imports.append(f"from {node.module} import ...")
        elif isinstance(node, ast.FunctionDef):
            functions.append({
                "name": node.name,
                "lineno": node.lineno,
                "args": [a.arg for a in node.args.args],
            })
        elif isinstance(node, ast.AsyncFunctionDef):
            functions.append({
                "name": node.name,
                "lineno": node.lineno,
                "args": [a.arg for a in node.args.args],
            })
        elif isinstance(node, ast.ClassDef):
            classes.append({
                "name": node.name,
                "lineno": node.lineno,
            })

    return {
        "state": "SUCCESS",
        "language": "python",
        "imports": imports,
        "functions": functions,
        "classes": classes,
        "summary": {
            "function_count": len(functions),
            "class_count": len(classes),
        },
    }


def generate_python_snippet(task: str, *, language: str = "python") -> dict[str, Any]:
    """Generate a deterministic local code template from task text.

    This is intentionally narrow and explicit: it produces basic, safe templates
    instead of pretending to be a frontier code model.
    """
    task = str(task or "").strip()
    if not task:
        return {"state": "FAILURE", "message": "task is empty"}
    if language.lower() != "python":
        return {"state": "PARTIAL", "message": f"Only Python is implemented locally; requested {language}"}

    lower = task.lower()
    if "reverse" in lower and "list" in lower:
        snippet = '''def reverse_list(values):
    if values is None:
        return []
    return list(reversed(values))
'''
    elif "json" in lower and "load" in lower:
        snippet = '''import json

def load_json_file(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)
'''
    elif "file" in lower and "read" in lower:
        snippet = '''from pathlib import Path


def read_text_file(path):
    return Path(path).read_text(encoding="utf-8")
'''
    elif "sum" in lower and "numbers" in lower:
        snippet = '''def sum_numbers(values):
    return sum(int(v) for v in values)
'''
    else:
        snippet = '''def solve_task(values):
    """Generic deterministic local helper."""
    if values is None:
        return []
    return list(values)
'''

    return {
        "state": "SUCCESS",
        "language": "python",
        "snippet": snippet,
        "task": task,
        "model": "ForgeCode-local",
    }


def repair_python_source(source: str, issue: str) -> dict[str, Any]:
    """Apply simple deterministic repairs to a Python source string."""
    text = str(source or "")
    issue = str(issue or "")

    try:
        ast.parse(text)
        return {
            "state": "SUCCESS",
            "message": "source already parses; no repair needed",
            "source": text,
        }
    except SyntaxError as exc:
        lines = text.splitlines()
        if not lines:
            lines = ["pass"]
        if issue and "missing" in issue.lower() and "colon" in issue.lower():
            lines[exc.lineno - 1] = lines[exc.lineno - 1].rstrip() + ":"
        elif issue and "return" in issue.lower() and "indent" in issue.lower():
            indent = "    "
            if exc.lineno > 0 and exc.lineno <= len(lines):
                lines.insert(exc.lineno, indent + "return None")
        else:
            # Final fallback: append a minimal valid block.
            lines.append("\n")
            lines.append("def _forgelm_local_patch():")
            lines.append("    return None")

        repaired = "\n".join(lines)
        try:
            ast.parse(repaired)
            return {
                "state": "SUCCESS",
                "message": "repair-applied",
                "source": repaired,
            }
        except SyntaxError:
            return {
                "state": "FAILURE",
                "message": "could-not-apply-safe-repair",
                "source": text,
            }


def local_code_plan(task: str, repo_root: str | None = None) -> dict[str, Any]:
    """Return a local code-work plan without any external escalation."""
    root = Path(repo_root) if repo_root else Path.cwd()
    plan = [
        {"id": "inspect", "action": "read the relevant local files and validate syntax"},
        {"id": "patch", "action": "apply the smallest deterministic change"},
        {"id": "verify", "action": "run local checks or parse validation"},
        {"id": "rollback", "action": "keep a reversible local checkpoint for undo"},
    ]
    return {
        "state": "SUCCESS",
        "task": str(task),
        "repo_root": str(root),
        "steps": plan,
        "external_models": False,
    }


def build_code_evidence(task: str, source: str | None = None) -> dict[str, Any]:
    evidence = {
        "task": str(task),
        "language": "python",
        "local_only": True,
        "network_required": False,
        "syntactic_check": inspect_python_module(source or "").get("state") == "SUCCESS",
    }
    return {"state": "SUCCESS", "evidence": evidence}


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Local ForgeCode capability")
    parser.add_argument("--task", default="write a local helper")
    parser.add_argument("--source", default="")
    parser.add_argument("--issue", default="")
    args = parser.parse_args()

    if args.source:
        result = repair_python_source(args.source, args.issue)
    else:
        result = generate_python_snippet(args.task)
    print(json.dumps(result, indent=2, sort_keys=True))


__all__ = [
    "inspect_python_module",
    "generate_python_snippet",
    "repair_python_source",
    "local_code_plan",
    "build_code_evidence",
]
