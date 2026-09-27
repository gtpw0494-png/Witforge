from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List

from .dataset import detect_secret


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _messages(trace: Dict[str, Any]) -> List[Dict[str, str]]:
    if isinstance(trace.get("messages"), list):
        out = []
        for m in trace["messages"]:
            if isinstance(m, dict) and str(m.get("content", "")).strip():
                out.append({"role": str(m.get("role", "user")), "content": str(m["content"])})
        if out:
            return out
    text = str(trace.get("input", trace.get("user_input", ""))).strip()
    return [{"role": "user", "content": text}] if text else []


def convert_traces(paths: Iterable[str], sft_out: str | Path, preference_out: str | Path, report_out: str | Path) -> Dict[str, Any]:
    sft_rows: List[Dict[str, Any]] = []
    pref_rows: List[Dict[str, Any]] = []
    rejected: Dict[str, int] = {}

    def reject(reason: str) -> None:
        rejected[reason] = rejected.get(reason, 0) + 1

    for raw in paths:
        path = Path(raw)
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row, dict):
                reject("non-object")
                continue
            if row.get("training_eligible") is not True:
                reject("not-training-eligible")
                continue
            if row.get("verified") is not True:
                reject("unverified")
                continue
            state = str(row.get("result", row.get("result_state", "SUCCESS"))).upper()
            if state != "SUCCESS":
                reject("non-success-result")
                continue
            messages = _messages(row)
            final_response = str(row.get("final_response", "")).strip()
            tool_call = row.get("tool_call")
            tool_result = row.get("tool_result")
            rejected_response = str(row.get("rejected_response", "")).strip()
            if isinstance(row.get("correction"), dict):
                rejected_response = rejected_response or str(row["correction"].get("original_response", "")).strip()
                final_response = final_response or str(row["correction"].get("corrected_response", "")).strip()

            blob = json.dumps(row, ensure_ascii=False)
            secret = detect_secret(blob)
            if secret:
                reject("secret:" + secret)
                continue

            if messages and isinstance(tool_call, dict):
                sft_rows.append({
                    "approved": True,
                    "kind": "TOOL_CALL",
                    "messages": messages,
                    "tool_call": tool_call,
                    "provenance": {"trace_id": row.get("id"), "verified": True},
                })

            if final_response:
                chat_messages = list(messages)
                if tool_result is not None:
                    chat_messages.append({
                        "role": "tool",
                        "content": json.dumps(tool_result, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
                    })
                if chat_messages:
                    sft_rows.append({
                        "approved": True,
                        "kind": "CHAT",
                        "messages": chat_messages,
                        "response": final_response,
                        "provenance": {"trace_id": row.get("id"), "verified": True},
                    })

            if messages and final_response and rejected_response and rejected_response != final_response:
                pref_rows.append({
                    "approved": True,
                    "messages": messages,
                    "chosen": final_response,
                    "rejected": rejected_response,
                    "provenance": {"trace_id": row.get("id"), "verified": True, "source": "correction"},
                })

            if not isinstance(tool_call, dict) and not final_response:
                reject("no-trainable-output")

    sft_path, pref_path, report_path = Path(sft_out), Path(preference_out), Path(report_out)
    for path in (sft_path, pref_path, report_path):
        path.parent.mkdir(parents=True, exist_ok=True)
    sft_path.write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in sft_rows), encoding="utf-8")
    pref_path.write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in pref_rows), encoding="utf-8")
    report = {
        "schema": "witforge.forgelm.trace-conversion-report.v1",
        "sft_rows": len(sft_rows),
        "preference_rows": len(pref_rows),
        "rejected": dict(sorted(rejected.items())),
        "sft_sha256": sha256_file(sft_path),
        "preference_sha256": sha256_file(pref_path),
        "sources": [{"path": str(Path(x)), "sha256": sha256_file(Path(x))} for x in paths],
    }
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report


def main() -> None:
    p = argparse.ArgumentParser(description="Convert verified WitForge traces into governed ForgeLM SFT/preference data")
    p.add_argument("--input", nargs="+", required=True)
    p.add_argument("--sft-out", required=True)
    p.add_argument("--preference-out", required=True)
    p.add_argument("--report", required=True)
    args = p.parse_args()
    print(json.dumps(convert_traces(args.input, args.sft_out, args.preference_out, args.report), indent=2))


if __name__ == "__main__":
    main()
