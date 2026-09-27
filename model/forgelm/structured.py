from __future__ import annotations

import itertools
import json
from typing import Any, Dict, Iterable, List, Sequence


class UnsupportedSchema(ValueError):
    pass


def _finite_values(schema: Dict[str, Any], *, limit: int) -> List[Any]:
    if "const" in schema:
        return [schema["const"]]
    if isinstance(schema.get("enum"), list):
        if not schema["enum"]:
            raise UnsupportedSchema("enum must not be empty")
        return list(schema["enum"])
    kind = schema.get("type")
    if kind == "boolean":
        return [False, True]
    if kind == "null":
        return [None]
    if kind == "integer":
        if "minimum" not in schema or "maximum" not in schema:
            raise UnsupportedSchema("integer schemas require finite minimum and maximum")
        lo, hi = int(schema["minimum"]), int(schema["maximum"])
        if hi < lo or hi - lo + 1 > min(limit, 128):
            raise UnsupportedSchema("integer range is invalid or too large")
        return list(range(lo, hi + 1))
    if kind == "string":
        raise UnsupportedSchema("open-ended strings require an external grammar backend; use enum/const")
    if kind == "array":
        items = schema.get("items")
        mn = int(schema.get("minItems", 0))
        mx = int(schema.get("maxItems", mn))
        if not isinstance(items, dict) or mn != mx or mx > 8:
            raise UnsupportedSchema("arrays require equal finite minItems/maxItems <= 8")
        vals = _finite_values(items, limit=limit)
        combos = list(itertools.product(vals, repeat=mn))
        if len(combos) > limit:
            raise UnsupportedSchema("array expands beyond candidate limit")
        return [list(x) for x in combos]
    if kind == "object":
        if schema.get("additionalProperties", True) is not False:
            raise UnsupportedSchema("strict objects require additionalProperties=false")
        props = schema.get("properties")
        required = schema.get("required")
        if not isinstance(props, dict) or not isinstance(required, list):
            raise UnsupportedSchema("object requires properties and required")
        if set(required) != set(props):
            raise UnsupportedSchema("finite strict objects require every property")
        ordered = list(props)
        value_sets = [_finite_values(props[name], limit=limit) for name in ordered]
        count = 1
        for values in value_sets:
            count *= len(values)
            if count > limit:
                raise UnsupportedSchema("object expands beyond candidate limit")
        return [dict(zip(ordered, values)) for values in itertools.product(*value_sets)]
    raise UnsupportedSchema(f"unsupported or non-finite schema type: {kind!r}")


def compile_finite_json_schema(schema: Dict[str, Any], *, max_candidates: int = 1024) -> List[str]:
    if not isinstance(schema, dict):
        raise UnsupportedSchema("schema must be an object")
    values = _finite_values(schema, limit=max_candidates)
    if len(values) > max_candidates:
        raise UnsupportedSchema("schema expands beyond candidate limit")
    return [json.dumps(v, ensure_ascii=False, separators=(",", ":"), sort_keys=False) for v in values]


class TokenTrieConstraint:
    def __init__(self, tokenizer, candidates: Sequence[str], *, prompt_length: int):
        if not candidates:
            raise ValueError("at least one candidate is required")
        self.prompt_length = int(prompt_length)
        self.eos_token_id = int(tokenizer.eos_token_id)
        self.root: Dict[int, dict] = {}
        self.terminals = set()
        for text in candidates:
            ids = tuple(int(x) for x in tokenizer.encode(text))
            if not ids:
                raise ValueError("candidate tokenized to empty sequence")
            node = self.root
            prefix = []
            for token in ids:
                prefix.append(token)
                node = node.setdefault(token, {})
            self.terminals.add(tuple(prefix))

    def allowed(self, full_ids) -> Iterable[int]:
        generated = tuple(int(x) for x in full_ids[0, self.prompt_length:].tolist())
        node = self.root
        for token in generated:
            if token not in node:
                return []
            node = node[token]
        allowed = list(node.keys())
        if generated in self.terminals:
            allowed.append(self.eos_token_id)
        return allowed


def constraint_for_schema(tokenizer, schema: Dict[str, Any], *, prompt_length: int, max_candidates: int = 1024) -> TokenTrieConstraint:
    candidates = compile_finite_json_schema(schema, max_candidates=max_candidates)
    return TokenTrieConstraint(tokenizer, candidates, prompt_length=prompt_length)
