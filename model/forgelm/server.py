from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import time
from typing import Any, Dict, List

import torch

from .checkpoint import load_checkpoint
from .generation import generate
from .structured import TokenTrieConstraint, UnsupportedSchema, compile_finite_json_schema\nfrom .quantization import apply_inference_quantization, quantization_report

MAX_BODY_BYTES = 1024 * 1024
LOOPBACKS = {"127.0.0.1", "localhost", "::1"}


def render_messages(messages: List[Dict[str, Any]]) -> str:
    parts: List[str] = []
    for message in messages[-24:]:
        if not isinstance(message, dict):
            continue
        role = str(message.get("role", "user")).lower()
        content = str(message.get("content", "")).strip()
        if not content:
            continue
        tag = {
            "system": "<|platform|>",
            "developer": "<|developer|>",
            "assistant": "<|assistant|>",
            "tool": "<|tool_result|>",
        }.get(role, "<|user|>")
        parts.append(f"{tag}\n{content}\n<|end_turn|>")
    parts.append("<|assistant|>\n")
    return "\n".join(parts)


class ForgeNativeService:
    def __init__(self, checkpoint: str | Path, device: str = "cpu", quantization: str = "none"):
        self.checkpoint = Path(checkpoint)
        self.model, self.tokenizer, self.manifest = load_checkpoint(self.checkpoint, device=device)
        self.model = apply_inference_quantization(self.model, quantization)
        self.quantization = quantization_report(self.model, quantization)
        self.device = next(self.model.parameters()).device
        self.model_id = self.checkpoint.name or "forgelm"
        self.started_at = time.time()

    def health(self) -> Dict[str, Any]:
        return {
            "ok": True,
            "service": "forge-native",
            "version": "1",
            "loaded": True,
            "model": self.model_id,
            "parameter_count": self.manifest.get("parameter_count"),
            "step": self.manifest.get("step"),
            "context_length": self.model.config.max_position_embeddings,
            "tokenizer_schema": getattr(self.tokenizer, "schema", "unknown"),
            "capabilities": ["text_generation", "structured_output"],\n            "quantization": self.quantization,
            "uptime_seconds": round(time.time() - self.started_at, 3),
        }

    def models(self) -> Dict[str, Any]:
        h = self.health()
        return {"object": "list", "data": [{
            "id": self.model_id,
            "object": "model",
            "owned_by": "witforge-local",
            "context_length": h["context_length"],
            "parameter_count": h["parameter_count"],
        }]}

    def chat(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        requested = str(payload.get("model") or self.model_id)
        if requested not in {self.model_id, "forgelm-nano", "forgelm"}:
            raise ValueError(f"model {requested!r} is not loaded")
        messages = payload.get("messages")
        if not isinstance(messages, list) or not messages:
            raise ValueError("messages must be a non-empty array")
        prompt = render_messages(messages)
        ids = self.tokenizer.encode(prompt, add_bos=True)
        if len(ids) >= self.model.config.max_position_embeddings:
            raise ValueError("prompt exceeds model context window")
        max_tokens = min(512, max(1, int(payload.get("max_tokens", payload.get("max_output_tokens", 128)))))
        temperature = float(payload.get("temperature", 0.8))
        top_p = float(payload.get("top_p", 0.95))
        top_k = int(payload.get("top_k", 50))
        repetition_penalty = float(payload.get("repetition_penalty", 1.05))
        input_ids = torch.tensor([ids], dtype=torch.long, device=self.device)
        response_format = payload.get("response_format")
        allowed_token_fn = None
        structured_candidates = None
        if isinstance(response_format, dict) and response_format.get("type") == "json_schema":
            spec = response_format.get("json_schema")
            schema = spec.get("schema") if isinstance(spec, dict) else None
            if not isinstance(schema, dict):
                raise ValueError("response_format.json_schema.schema must be an object")
            try:
                structured_candidates = compile_finite_json_schema(schema, max_candidates=256)
            except UnsupportedSchema as exc:
                raise ValueError("unsupported strict JSON schema: " + str(exc))
            required_tokens = max(len(self.tokenizer.encode(x)) for x in structured_candidates) + 1
            if max_tokens < required_tokens:
                raise ValueError(f"max_tokens must be at least {required_tokens} for this finite JSON schema")
            constraint = TokenTrieConstraint(self.tokenizer, structured_candidates, prompt_length=input_ids.shape[1])
            allowed_token_fn = constraint.allowed

        started = time.time()
        out = generate(
            self.model,
            input_ids,
            max_new_tokens=max_tokens,
            eos_token_id=self.tokenizer.eos_token_id,
            temperature=temperature,
            top_k=top_k,
            top_p=top_p,
            repetition_penalty=repetition_penalty,
            allowed_token_fn=allowed_token_fn,
        )
        generated_ids = out[0, input_ids.shape[1]:].tolist()
        content = self.tokenizer.decode(generated_ids, skip_special_tokens=True).strip()
        if structured_candidates is not None:
            if content not in set(structured_candidates):
                raise ValueError("structured generation ended before a valid schema instance completed")
            json.loads(content)
        return {
            "id": f"forge-{int(time.time() * 1000)}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": self.model_id,
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop" if len(generated_ids) < max_tokens else "length",
            }],
            "usage": {
                "prompt_tokens": len(ids),
                "completion_tokens": len(generated_ids),
                "total_tokens": len(ids) + len(generated_ids),
            },
            "latency_ms": round((time.time() - started) * 1000, 3),
            "structured": structured_candidates is not None,
        }


def make_handler(service: ForgeNativeService):
    class Handler(BaseHTTPRequestHandler):
        server_version = "ForgeNative/1"

        def log_message(self, fmt: str, *args) -> None:
            return

        def _json(self, code: int, obj: Any) -> None:
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path == "/health":
                return self._json(200, service.health())
            if self.path == "/v1/models":
                return self._json(200, service.models())
            return self._json(404, {"error": {"code": "not_found", "message": "route not found"}})

        def do_POST(self) -> None:
            if self.path != "/v1/chat/completions":
                return self._json(404, {"error": {"code": "not_found", "message": "route not found"}})
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                return self._json(400, {"error": {"code": "invalid_content_length", "message": "invalid content length"}})
            if length <= 0 or length > MAX_BODY_BYTES:
                return self._json(413, {"error": {"code": "body_size", "message": "request body is empty or too large"}})
            if "application/json" not in str(self.headers.get("Content-Type", "")).lower():
                return self._json(415, {"error": {"code": "content_type", "message": "application/json required"}})
            try:
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict):
                    raise ValueError("JSON object required")
                result = service.chat(payload)
                return self._json(200, result)
            except ValueError as exc:
                return self._json(400, {"error": {"code": "invalid_request", "message": str(exc)}})
            except Exception as exc:
                return self._json(500, {"error": {"code": "inference_failed", "message": str(exc)[:200]}})

    return Handler


def make_server(service: ForgeNativeService, host: str = "127.0.0.1", port: int = 11435) -> ThreadingHTTPServer:
    if host not in LOOPBACKS:
        raise ValueError("ForgeNative may bind only to loopback")
    return ThreadingHTTPServer((host, int(port)), make_handler(service))


def main() -> None:
    p = argparse.ArgumentParser(description="ForgeLM localhost inference server")
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--device", default="cpu")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=11435)\n    p.add_argument("--quantization", choices=["none", "dynamic-int8"], default="none")
    args = p.parse_args()
    service = ForgeNativeService(args.checkpoint, device=args.device, quantization=args.quantization)
    server = make_server(service, args.host, args.port)
    print(json.dumps({"ok": True, "listen": f"http://{args.host}:{server.server_port}", "health": service.health()}, ensure_ascii=False), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
