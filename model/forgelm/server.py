from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import time
import threading
import math
from typing import Any, Dict, Iterator, List

import torch

from .checkpoint import load_checkpoint
from .generation import generate_with_stats, iter_generate
from .structured import TokenTrieConstraint, UnsupportedSchema, compile_finite_json_schema
from .quantization import apply_inference_quantization, quantization_report
from .promotion import verify_release_manifest

MAX_BODY_BYTES = 1024 * 1024
LOOPBACKS = {"127.0.0.1", "localhost", "::1"}


class InferenceBusy(RuntimeError):
    pass


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
    def __init__(
        self,
        checkpoint: str | Path,
        device: str = "cpu",
        quantization: str = "none",
        release_manifest: str | Path | None = None,
        require_promoted: bool = False,
        release_key: str | None = None,
        max_concurrent: int = 1,
        queue_timeout_seconds: float = 5.0,
    ):
        self.checkpoint = Path(checkpoint)
        self.model, self.tokenizer, self.manifest = load_checkpoint(self.checkpoint, device=device)
        self.model = apply_inference_quantization(self.model, quantization)
        self.quantization = quantization_report(self.model, quantization)
        self.device = next(self.model.parameters()).device
        self.release_verification = None
        if release_manifest is not None:
            self.release_verification = verify_release_manifest(
                release_manifest,
                self.checkpoint,
                signing_key=release_key,
                allow_unsigned_dev=not require_promoted,
            )
            if not self.release_verification["ok"]:
                raise ValueError("release manifest verification failed")
        elif require_promoted:
            raise ValueError("--require-promoted requires --release-manifest")
        self.require_promoted = bool(require_promoted)
        self.model_id = self.checkpoint.name or "forgelm"
        self.started_at = time.time()
        self.max_concurrent = max(1, min(32, int(max_concurrent)))
        self.queue_timeout_seconds = max(0.0, min(300.0, float(queue_timeout_seconds)))
        self._inference_gate = threading.BoundedSemaphore(self.max_concurrent)
        self._metrics_lock = threading.Lock()
        self._runtime_metrics = {
            "active": 0,
            "queued": 0,
            "completed": 0,
            "failed": 0,
            "rejected": 0,
            "queue_wait_ms_total": 0.0,
            "inference_ms_total": 0.0,
        }

    def _runtime_snapshot(self) -> Dict[str, Any]:
        with self._metrics_lock:
            metrics = dict(self._runtime_metrics)
        finished = metrics["completed"] + metrics["failed"]
        return {
            "max_concurrent": self.max_concurrent,
            "queue_timeout_seconds": self.queue_timeout_seconds,
            "active": metrics["active"],
            "queued": metrics["queued"],
            "completed": metrics["completed"],
            "failed": metrics["failed"],
            "rejected": metrics["rejected"],
            "average_queue_wait_ms": round(metrics["queue_wait_ms_total"] / finished, 3) if finished else 0.0,
            "average_inference_ms": round(metrics["inference_ms_total"] / finished, 3) if finished else 0.0,
        }

    def _acquire_inference_slot(self) -> Dict[str, float]:
        queued_at = time.perf_counter()
        with self._metrics_lock:
            self._runtime_metrics["queued"] += 1
        acquired = self._inference_gate.acquire(timeout=self.queue_timeout_seconds)
        wait_ms = (time.perf_counter() - queued_at) * 1000.0
        with self._metrics_lock:
            self._runtime_metrics["queued"] -= 1
            if not acquired:
                self._runtime_metrics["rejected"] += 1
            else:
                self._runtime_metrics["active"] += 1
                self._runtime_metrics["queue_wait_ms_total"] += wait_ms
        if not acquired:
            raise InferenceBusy("ForgeNative inference queue is full; retry later")
        return {"acquired_at": time.perf_counter(), "queue_wait_ms": wait_ms}

    def _release_inference_slot(self, lease: Dict[str, float], *, success: bool) -> None:
        elapsed_ms = max(0.0, (time.perf_counter() - lease["acquired_at"]) * 1000.0)
        with self._metrics_lock:
            self._runtime_metrics["active"] = max(0, self._runtime_metrics["active"] - 1)
            self._runtime_metrics["completed" if success else "failed"] += 1
            self._runtime_metrics["inference_ms_total"] += elapsed_ms
        self._inference_gate.release()

    def health(self) -> Dict[str, Any]:
        return {
            "ok": True,
            "service": "forge-native",
            "version": "3",
            "loaded": True,
            "model": self.model_id,
            "parameter_count": self.manifest.get("parameter_count"),
            "step": self.manifest.get("step"),
            "context_length": self.model.config.max_position_embeddings,
            "tokenizer_schema": getattr(self.tokenizer, "schema", "unknown"),
            "capabilities": ["text_generation", "structured_output", "kv_cache_telemetry", "sse_streaming", "responses_api", "stop_sequences", "deterministic_seed", "cache_strategy_control", "bounded_concurrency"],
            "cache_strategy": "dynamic",
            "cache_strategies": ["dynamic", "static", "none"],
            "quantization": self.quantization,
            "release_verified": bool(self.release_verification and self.release_verification.get("ok")),
            "release_version": self.release_verification["release"].get("release_version") if self.release_verification else None,
            "promotion_required": self.require_promoted,
            "inference_runtime": self._runtime_snapshot(),
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

    def _prepare_chat(self, payload: Dict[str, Any]) -> Dict[str, Any]:
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
        raw_max_tokens = payload.get("max_tokens", payload.get("max_output_tokens", 128))
        if isinstance(raw_max_tokens, bool) or not isinstance(raw_max_tokens, (int, float)) or not math.isfinite(float(raw_max_tokens)):
            raise ValueError("max_tokens must be a finite number")
        max_tokens = int(raw_max_tokens)
        if max_tokens < 1 or max_tokens > 512:
            raise ValueError("max_tokens must be between 1 and 512")

        temperature = float(payload.get("temperature", 0.8))
        if not math.isfinite(temperature) or temperature < 0.0 or temperature > 5.0:
            raise ValueError("temperature must be finite and between 0 and 5")

        top_p = float(payload.get("top_p", 0.95))
        if not math.isfinite(top_p) or top_p <= 0.0 or top_p > 1.0:
            raise ValueError("top_p must be finite and in (0, 1]")

        raw_top_k = payload.get("top_k", 50)
        if isinstance(raw_top_k, bool) or not isinstance(raw_top_k, (int, float)) or not math.isfinite(float(raw_top_k)):
            raise ValueError("top_k must be a finite number")
        top_k = int(raw_top_k)
        if top_k < 0 or top_k > self.model.config.vocab_size:
            raise ValueError("top_k must be between 0 and the model vocabulary size")

        repetition_penalty = float(payload.get("repetition_penalty", 1.05))
        if not math.isfinite(repetition_penalty) or repetition_penalty <= 0.0 or repetition_penalty > 10.0:
            raise ValueError("repetition_penalty must be finite and in (0, 10]")

        cache_strategy = str(payload.get("cache_strategy", "dynamic")).lower()
        if cache_strategy not in {"dynamic", "static", "none"}:
            raise ValueError("cache_strategy must be one of: dynamic, static, none")
        seed = payload.get("seed")
        if seed is not None:
            if isinstance(seed, bool) or not isinstance(seed, int):
                raise ValueError("seed must be an integer")
            if seed < 0 or seed >= 2 ** 63:
                raise ValueError("seed must be in [0, 2^63)")
        input_ids = torch.tensor([ids], dtype=torch.long, device=self.device)

        raw_stop = payload.get("stop")
        stop_strings: List[str] = []
        if isinstance(raw_stop, str):
            if raw_stop:
                stop_strings = [raw_stop]
        elif isinstance(raw_stop, list):
            if len(raw_stop) > 8:
                raise ValueError("stop supports at most 8 strings")
            for value in raw_stop:
                if not isinstance(value, str) or not value:
                    raise ValueError("stop array values must be non-empty strings")
                stop_strings.append(value)
        elif raw_stop is not None:
            raise ValueError("stop must be a string or array of strings")
        if any(len(value) > 256 for value in stop_strings):
            raise ValueError("each stop string must be at most 256 characters")
        stop_token_sequences = [self.tokenizer.encode(value) for value in stop_strings]
        if any(not seq for seq in stop_token_sequences):
            raise ValueError("stop string tokenized to an empty sequence")

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

        return {
            "ids": ids,
            "input_ids": input_ids,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": top_p,
            "top_k": top_k,
            "repetition_penalty": repetition_penalty,
            "cache_strategy": cache_strategy,
            "seed": seed,
            "allowed_token_fn": allowed_token_fn,
            "structured_candidates": structured_candidates,
            "stop_strings": stop_strings,
            "stop_token_sequences": stop_token_sequences,
        }

    def _validate_structured(self, content: str, candidates) -> None:
        if candidates is None:
            return
        normalized = content.strip()
        if normalized not in set(candidates):
            raise ValueError("structured generation ended before a valid schema instance completed")
        json.loads(normalized)

    def _responses_payload_to_chat(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        requested = payload.get("model") or self.model_id
        raw_input = payload.get("input")
        messages: List[Dict[str, str]] = []
        if isinstance(raw_input, str):
            if not raw_input.strip():
                raise ValueError("input must not be empty")
            messages = [{"role": "user", "content": raw_input}]
        elif isinstance(raw_input, list):
            for item in raw_input:
                if not isinstance(item, dict):
                    raise ValueError("input array items must be objects")
                role = str(item.get("role", "user")).lower()
                content = item.get("content", "")
                if isinstance(content, list):
                    texts = []
                    for part in content:
                        if isinstance(part, dict):
                            value = part.get("text", part.get("input_text", part.get("output_text", "")))
                            if value:
                                texts.append(str(value))
                    content = "\n".join(texts)
                content = str(content).strip()
                if content:
                    messages.append({"role": role, "content": content})
            if not messages:
                raise ValueError("input array carried no usable messages")
        else:
            raise ValueError("input must be a non-empty string or message array")

        chat_payload: Dict[str, Any] = {
            "model": requested,
            "messages": messages,
            "max_output_tokens": payload.get("max_output_tokens", 128),
            "temperature": payload.get("temperature", 0.8),
            "top_p": payload.get("top_p", 0.95),
            "top_k": payload.get("top_k", 50),
            "repetition_penalty": payload.get("repetition_penalty", 1.05),
        }
        if "cache_strategy" in payload:
            chat_payload["cache_strategy"] = payload.get("cache_strategy")
        if "seed" in payload:
            chat_payload["seed"] = payload.get("seed")
        if "stop" in payload:
            chat_payload["stop"] = payload.get("stop")
        text = payload.get("text")
        fmt = text.get("format") if isinstance(text, dict) else None
        if isinstance(fmt, dict) and fmt.get("type") == "json_schema":
            chat_payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": str(fmt.get("name") or "response"),
                    "strict": bool(fmt.get("strict", True)),
                    "schema": fmt.get("schema"),
                },
            }
        return chat_payload

    def responses(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        chat_payload = self._responses_payload_to_chat(payload)
        chat = self.chat(chat_payload)
        text = chat["choices"][0]["message"]["content"]
        response_id = "resp-" + chat["id"].removeprefix("forge-")
        return {
            "id": response_id,
            "object": "response",
            "created_at": chat["created"],
            "status": "completed",
            "model": chat["model"],
            "output": [{
                "id": "msg-" + response_id.removeprefix("resp-"),
                "type": "message",
                "role": "assistant",
                "status": "completed",
                "content": [{"type": "output_text", "text": text}],
            }],
            "output_text": text,
            "usage": {
                "input_tokens": chat["usage"]["prompt_tokens"],
                "output_tokens": chat["usage"]["completion_tokens"],
                "total_tokens": chat["usage"]["total_tokens"],
            },
            "inference": chat["inference"],
            "structured": chat["structured"],
        }

    def stream_responses(self, payload: Dict[str, Any]) -> Iterator[Dict[str, Any]]:
        chat_payload = self._responses_payload_to_chat(payload)
        chat_events = self.stream_chat(chat_payload)
        response_id = f"resp-{int(time.time() * 1000)}"
        created = int(time.time())

        def events() -> Iterator[Dict[str, Any]]:
            sequence = 0
            text_parts: List[str] = []
            final = None
            try:
                yield {
                    "type": "response.created",
                    "sequence_number": sequence,
                    "response": {
                        "id": response_id,
                        "object": "response",
                        "created_at": created,
                        "status": "in_progress",
                        "model": str(chat_payload.get("model") or self.model_id),
                    },
                }
                sequence += 1
                for chunk in chat_events:
                    choice = chunk.get("choices", [{}])[0]
                    delta = choice.get("delta", {})
                    if "content" in delta:
                        piece = str(delta.get("content") or "")
                        if piece:
                            text_parts.append(piece)
                        yield {
                            "type": "response.output_text.delta",
                            "sequence_number": sequence,
                            "response_id": response_id,
                            "delta": piece,
                            "token_id": chunk.get("token_id"),
                        }
                        sequence += 1
                    if chunk.get("usage"):
                        final = chunk
                if final is None:
                    raise RuntimeError("response stream ended without final usage")

                output_text = "".join(text_parts)
                yield {
                    "type": "response.output_text.done",
                    "sequence_number": sequence,
                    "response_id": response_id,
                    "text": output_text,
                }
                sequence += 1
                yield {
                    "type": "response.completed",
                    "sequence_number": sequence,
                    "response": {
                        "id": response_id,
                        "object": "response",
                        "created_at": created,
                        "status": "completed",
                        "model": final["model"],
                        "output": [{
                            "id": "msg-" + response_id.removeprefix("resp-"),
                            "type": "message",
                            "role": "assistant",
                            "status": "completed",
                            "content": [{"type": "output_text", "text": output_text}],
                        }],
                        "output_text": output_text,
                        "usage": {
                            "input_tokens": final["usage"]["prompt_tokens"],
                            "output_tokens": final["usage"]["completion_tokens"],
                            "total_tokens": final["usage"]["total_tokens"],
                        },
                        "inference": final["inference"],
                        "structured": final["structured"],
                    },
                }
            finally:
                close = getattr(chat_events, "close", None)
                if callable(close):
                    close()

        return events()

    def chat(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        prep = self._prepare_chat(payload)
        lease = self._acquire_inference_slot()
        started = time.time()
        success = False
        try:
            generation = generate_with_stats(
                self.model,
                prep["input_ids"],
                max_new_tokens=prep["max_tokens"],
                eos_token_id=self.tokenizer.eos_token_id,
                temperature=prep["temperature"],
                top_k=prep["top_k"],
                top_p=prep["top_p"],
                repetition_penalty=prep["repetition_penalty"],
                seed=prep["seed"],
                allowed_token_fn=prep["allowed_token_fn"],
                stop_token_sequences=prep["stop_token_sequences"],
                cache_strategy=prep["cache_strategy"],
            )
            generated_ids = generation.output_ids[0, prep["input_ids"].shape[1]:].tolist()
            content = self.tokenizer.decode(generated_ids, skip_special_tokens=True).strip()
            self._validate_structured(content, prep["structured_candidates"])
            success = True
            return {
                "id": f"forge-{int(time.time() * 1000)}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": self.model_id,
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": content},
                    "finish_reason": "stop" if generation.stats.stop_reason in {"eos", "stop_sequence"} else "length",
                }],
                "usage": {
                    "prompt_tokens": len(prep["ids"]),
                    "completion_tokens": len(generated_ids),
                    "total_tokens": len(prep["ids"]) + len(generated_ids),
                },
                "latency_ms": round((time.time() - started) * 1000, 3),
                "structured": prep["structured_candidates"] is not None,
                "inference": {
                    "cache_strategy": prep["cache_strategy"],
                    "kv_cache": {
                        "peak_bytes": generation.stats.peak_kv_cache_bytes,
                        "final_bytes": generation.stats.final_kv_cache_bytes,
                        "layers": generation.stats.cache_layers,
                    },
                    "stop_reason": generation.stats.stop_reason,
                    "matched_stop_index": generation.stats.matched_stop_index,
                    "sampled_tokens": generation.stats.sampled_tokens,
                    "seed": prep["seed"],
                    "queue_wait_ms": round(lease["queue_wait_ms"], 3),
                    "max_context_tokens": generation.stats.max_context_tokens,
                },
            }
        finally:
            self._release_inference_slot(lease, success=success)

    def stream_chat(self, payload: Dict[str, Any]) -> Iterator[Dict[str, Any]]:
        prep = self._prepare_chat(payload)
        lease = self._acquire_inference_slot()
        request_id = f"forge-{int(time.time() * 1000)}"
        created = int(time.time())
        started = time.time()

        def events() -> Iterator[Dict[str, Any]]:
            success = False
            generated_ids: List[int] = []
            emitted_text = ""
            try:
                yield {
                    "id": request_id,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": self.model_id,
                    "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}],
                }
                final_stats = None
                for event in iter_generate(
                    self.model,
                    prep["input_ids"],
                    max_new_tokens=prep["max_tokens"],
                    eos_token_id=self.tokenizer.eos_token_id,
                    temperature=prep["temperature"],
                    top_k=prep["top_k"],
                    top_p=prep["top_p"],
                    repetition_penalty=prep["repetition_penalty"],
                    seed=prep["seed"],
                    allowed_token_fn=prep["allowed_token_fn"],
                    stop_token_sequences=prep["stop_token_sequences"],
                    cache_strategy=prep["cache_strategy"],
                ):
                    if event.token_id is not None:
                        generated_ids.append(event.token_id)
                        decoded = self.tokenizer.decode(generated_ids, skip_special_tokens=True)
                        stable = decoded.rstrip("\ufffd")
                        delta = stable[len(emitted_text):] if stable.startswith(emitted_text) else ""
                        if delta:
                            emitted_text = stable
                        yield {
                            "id": request_id,
                            "object": "chat.completion.chunk",
                            "created": created,
                            "model": self.model_id,
                            "token_id": event.token_id,
                            "choices": [{"index": 0, "delta": {"content": delta}, "finish_reason": None}],
                        }
                    if event.done:
                        final_stats = event.stats

                if final_stats is None:
                    raise RuntimeError("stream generation ended without final stats")

                final_raw = self.tokenizer.decode(generated_ids, skip_special_tokens=True)
                if final_raw.startswith(emitted_text):
                    tail = final_raw[len(emitted_text):]
                    if tail:
                        emitted_text = final_raw
                        yield {
                            "id": request_id,
                            "object": "chat.completion.chunk",
                            "created": created,
                            "model": self.model_id,
                            "choices": [{"index": 0, "delta": {"content": tail}, "finish_reason": None}],
                        }

                self._validate_structured(final_raw, prep["structured_candidates"])
                success = True
                yield {
                    "id": request_id,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": self.model_id,
                    "choices": [{
                        "index": 0,
                        "delta": {},
                        "finish_reason": "stop" if final_stats.stop_reason in {"eos", "stop_sequence"} else "length",
                    }],
                    "usage": {
                        "prompt_tokens": len(prep["ids"]),
                        "completion_tokens": len(generated_ids),
                        "total_tokens": len(prep["ids"]) + len(generated_ids),
                    },
                    "latency_ms": round((time.time() - started) * 1000, 3),
                    "structured": prep["structured_candidates"] is not None,
                    "inference": {
                        "cache_strategy": prep["cache_strategy"],
                        "kv_cache": {
                            "peak_bytes": final_stats.peak_kv_cache_bytes,
                            "final_bytes": final_stats.final_kv_cache_bytes,
                            "layers": final_stats.cache_layers,
                        },
                        "stop_reason": final_stats.stop_reason,
                        "matched_stop_index": final_stats.matched_stop_index,
                        "sampled_tokens": final_stats.sampled_tokens,
                        "seed": prep["seed"],
                        "queue_wait_ms": round(lease["queue_wait_ms"], 3),
                        "max_context_tokens": final_stats.max_context_tokens,
                    },
                }
            finally:
                self._release_inference_slot(lease, success=success)

        return events()


def make_handler(service: ForgeNativeService):
    class Handler(BaseHTTPRequestHandler):
        server_version = "ForgeNative/3"

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

        def _sse(self, iterator: Iterator[Dict[str, Any]]) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                for event in iterator:
                    payload = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
                    self.wfile.write(("data: " + payload + "\n\n").encode("utf-8"))
                    self.wfile.flush()
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                return
            except Exception as exc:
                try:
                    error = json.dumps({"error": {"code": "stream_failed", "message": str(exc)[:200]}}, ensure_ascii=False)
                    self.wfile.write(("data: " + error + "\n\n").encode("utf-8"))
                    self.wfile.write(b"data: [DONE]\n\n")
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    return
            finally:
                close = getattr(iterator, "close", None)
                if callable(close):
                    close()

        def do_GET(self) -> None:
            if self.path == "/health":
                return self._json(200, service.health())
            if self.path == "/v1/models":
                return self._json(200, service.models())
            return self._json(404, {"error": {"code": "not_found", "message": "route not found"}})

        def do_POST(self) -> None:
            if self.path not in {"/v1/chat/completions", "/v1/responses"}:
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
                if self.path == "/v1/responses":
                    if payload.get("stream") is True:
                        return self._sse(service.stream_responses(payload))
                    return self._json(200, service.responses(payload))
                if payload.get("stream") is True:
                    return self._sse(service.stream_chat(payload))
                return self._json(200, service.chat(payload))
            except InferenceBusy as exc:
                return self._json(503, {"error": {"code": "inference_busy", "message": str(exc), "retryable": True}})
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
    p.add_argument("--port", type=int, default=11435)
    p.add_argument("--quantization", choices=["none", "dynamic-int8"], default="none")
    p.add_argument("--release-manifest")
    p.add_argument("--require-promoted", action="store_true")
    p.add_argument("--max-concurrent", type=int, default=1)
    p.add_argument("--queue-timeout-seconds", type=float, default=5.0)
    args = p.parse_args()
    service = ForgeNativeService(
        args.checkpoint,
        device=args.device,
        quantization=args.quantization,
        release_manifest=args.release_manifest,
        require_promoted=args.require_promoted,
        max_concurrent=args.max_concurrent,
        queue_timeout_seconds=args.queue_timeout_seconds,
    )
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
