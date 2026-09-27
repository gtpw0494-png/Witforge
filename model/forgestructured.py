"""Local structured-output capability layer for ForgeLM.

This module provides deterministic JSON/schema validation and HTML-to-JSON
extraction without requiring access to any external parser or model.
"""
from __future__ import annotations

import json
import re
from typing import Any


def _strip_code_fence(text: str) -> str:
    txt = str(text or "").strip()
    if txt.startswith("```"):
        txt = re.sub(r"^```[a-zA-Z]*\n?", "", txt)
        txt = re.sub(r"\n?```\s*$", "", txt)
    return txt.strip()


def extract_json(text: str) -> dict[str, Any]:
    """Extract a JSON object from a text blob if possible."""
    txt = _strip_code_fence(text)
    try:
        value = json.loads(txt)
        return {"state": "SUCCESS", "value": value}
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", txt, flags=re.DOTALL)
        if m:
            try:
                return {"state": "SUCCESS", "value": json.loads(m.group(0))}
            except json.JSONDecodeError:
                pass
    return {"state": "FAILURE", "message": "no valid JSON object found"}


def validate_against_schema(value: Any, schema: dict[str, Any]) -> dict[str, Any]:
    """Very lightweight schema validation for local structured output."""
    if not isinstance(schema, dict):
        return {"state": "FAILURE", "message": "schema must be an object"}

    expected = schema.get("type", "object")
    if expected == "object":
        if not isinstance(value, dict):
            return {"state": "FAILURE", "message": "expected object"}
        required = schema.get("required", [])
        missing = [field for field in required if field not in value]
        if missing:
            return {"state": "FAILURE", "message": f"missing fields: {missing}"}
        return {"state": "SUCCESS", "value": value}

    if expected == "array":
        if not isinstance(value, list):
            return {"state": "FAILURE", "message": "expected array"}
        return {"state": "SUCCESS", "value": value}

    if expected == "string":
        if not isinstance(value, str):
            return {"state": "FAILURE", "message": "expected string"}
        return {"state": "SUCCESS", "value": value}

    if expected == "number":
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            return {"state": "FAILURE", "message": "expected number"}
        return {"state": "SUCCESS", "value": value}

    return {"state": "SUCCESS", "value": value}


def html_to_json(html: str) -> dict[str, Any]:
    """Very small HTML-to-JSON conversion for local structured extraction."""
    txt = str(html or "")
    out: dict[str, Any] = {}
    title = re.search(r"<title[^>]*>(.*?)</title>", txt, flags=re.I | re.S)
    if title:
        out["title"] = re.sub(r"<.*?>", "", title.group(1)).strip()

    headings = re.findall(r"<h([1-6])[^>]*>(.*?)</h\1>", txt, flags=re.I | re.S)
    if headings:
        out["headings"] = [
            {"level": int(level), "text": re.sub(r"<.*?>", "", text).strip()}
            for level, text in headings
        ]

    for key in ["name", "description", "summary", "status"]:
        m = re.search(rf"<(?P<tag>[a-z0-9-]+)[^>]*name=[\"']{key}[\"'][^>]*>(.*?)</(?P=tag)>", txt, flags=re.I | re.S)
        if m:
            out[key] = re.sub(r"<.*?>", "", m.group(2)).strip()

    text_nodes = re.findall(r">\s*([^<>]+?)\s*<", txt, flags=re.S)
    if text_nodes and not out:
        out["text"] = " ".join(part.strip() for part in text_nodes if part.strip())

    return {"state": "SUCCESS", "value": out}


def infer_schema_from_text(text: str) -> dict[str, Any]:
    """Cheap schema inference from a text prompt or natural-language description."""
    txt = str(text or "")
    schema = {"type": "object", "required": []}
    if "name" in txt.lower():
        schema["required"].append("name")
    if "email" in txt.lower():
        schema["required"].append("email")
    if "status" in txt.lower():
        schema["required"].append("status")
    if not schema["required"]:
        schema["required"] = ["value"]
    return schema


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Local ForgeStructured capability")
    parser.add_argument("--text", default='{"name": "demo"}')
    parser.add_argument("--html", default="")
    args = parser.parse_args()

    if args.html:
        result = html_to_json(args.html)
    else:
        result = extract_json(args.text)
    print(json.dumps(result, indent=2, sort_keys=True))


__all__ = ["extract_json", "validate_against_schema", "html_to_json", "infer_schema_from_text"]
