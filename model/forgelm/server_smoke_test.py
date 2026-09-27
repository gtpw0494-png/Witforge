from __future__ import annotations

import json
from pathlib import Path
import tempfile
import threading
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from .checkpoint import save_checkpoint
from .configuration_forgelm import ForgeLMConfig
from .modeling_forgelm import ForgeLMForCausalLM
from .server import ForgeNativeService, InferenceBusy, make_server
from .tokenizer import ByteTokenizer


def request_json(url: str, body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = Request(url, data=data, headers={"Content-Type": "application/json"} if data else {}, method="POST" if data else "GET")
    with urlopen(req, timeout=10) as res:
        return res.status, json.loads(res.read().decode("utf-8"))


def request_error_json(url: str, body):
    data = json.dumps(body).encode("utf-8")
    req = Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(req, timeout=10) as res:
            return res.status, json.loads(res.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def request_sse(url: str, body):
    data = json.dumps(body).encode("utf-8")
    req = Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    events = []
    done = False
    with urlopen(req, timeout=10) as res:
        status = res.status
        content_type = res.headers.get("Content-Type", "")
        for raw in res:
            line = raw.decode("utf-8").strip()
            if not line.startswith("data: "):
                continue
            payload = line[6:]
            if payload == "[DONE]":
                done = True
                break
            events.append(json.loads(payload))
    return status, content_type, events, done


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="forge-server-") as td:
        cfg = ForgeLMConfig.smoke()
        model = ForgeLMForCausalLM(cfg)
        tok = ByteTokenizer(cfg.vocab_size)
        save_checkpoint(td, model, tok, step=0, metadata={"kind": "server-smoke"})
        service = ForgeNativeService(td)
        server = make_server(service, "127.0.0.1", 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            status, health = request_json(base + "/health")
            if status != 200 or not health.get("loaded"):
                raise AssertionError("health endpoint did not report a loaded model")
            if "stop_sequences" not in health.get("capabilities", []):
                raise AssertionError("health endpoint did not report stop-sequence capability")
            if "bounded_concurrency" not in health.get("capabilities", []):
                raise AssertionError("health endpoint did not report bounded concurrency capability")
            runtime = health.get("inference_runtime") or {}
            if runtime.get("max_concurrent") != 1 or int(runtime.get("active", -1)) != 0:
                raise AssertionError("health endpoint did not expose bounded concurrency runtime state")
            if health.get("cache_strategies") != ["dynamic", "static", "none"]:
                raise AssertionError("health endpoint did not report all cache strategies")
            status, models = request_json(base + "/v1/models")
            if status != 200 or not models.get("data"):
                raise AssertionError("models endpoint returned no model")

            prepared = service._prepare_chat({
                "model": service.model_id,
                "messages": [{"role": "user", "content": "stop normalization"}],
                "stop": ["END", "STOP"],
            })
            if prepared["stop_strings"] != ["END", "STOP"] or len(prepared["stop_token_sequences"]) != 2:
                raise AssertionError("chat preparation did not normalize stop strings")
            mapped = service._responses_payload_to_chat({
                "model": service.model_id,
                "input": "responses stop",
                "stop": "END",
            })
            if mapped.get("stop") != "END":
                raise AssertionError("responses API did not propagate stop configuration")
            status, chat = request_json(base + "/v1/chat/completions", {
                "model": service.model_id,
                "messages": [{"role": "user", "content": "hello"}],
                "max_tokens": 2,
                "temperature": 0,
            })
            if status != 200 or not isinstance(chat.get("choices"), list):
                raise AssertionError("chat endpoint failed")
            if chat["usage"]["completion_tokens"] < 1:
                raise AssertionError("chat endpoint generated no tokens")

            inference = chat.get("inference") or {}
            kv = inference.get("kv_cache") or {}
            if inference.get("cache_strategy") != "dynamic" or int(kv.get("peak_bytes", 0)) <= 0:
                raise AssertionError("chat endpoint did not expose measured dynamic KV-cache telemetry")
            if int(inference.get("sampled_tokens", 0)) < int(chat["usage"]["completion_tokens"]):
                raise AssertionError("chat sampled-token telemetry is inconsistent")
            if "matched_stop_index" not in inference:
                raise AssertionError("chat inference telemetry omitted matched_stop_index")

            status, content_type, stream_events, stream_done = request_sse(base + "/v1/chat/completions", {
                "model": service.model_id,
                "messages": [{"role": "user", "content": "stream hello"}],
                "max_tokens": 3,
                "temperature": 0,
                "stream": True,
            })
            if status != 200 or "text/event-stream" not in content_type or not stream_done:
                raise AssertionError("streaming chat did not complete as SSE")
            token_events = [event for event in stream_events if isinstance(event.get("token_id"), int)]
            final_events = [event for event in stream_events if event.get("usage")]
            if not final_events:
                raise AssertionError("streaming chat emitted no final usage event")
            final_event = final_events[-1]
            completion_tokens = int(final_event["usage"]["completion_tokens"])
            if completion_tokens < 1 or len(token_events) != completion_tokens:
                raise AssertionError("streaming chat did not emit one live event per generated token")
            if final_event.get("inference", {}).get("cache_strategy") != "dynamic":
                raise AssertionError("streaming chat omitted cache telemetry")

            status, response = request_json(base + "/v1/responses", {
                "model": service.model_id,
                "input": "hello responses",
                "max_output_tokens": 2,
                "temperature": 0,
            })
            if status != 200 or response.get("object") != "response" or response.get("status") != "completed":
                raise AssertionError("responses endpoint failed")
            if response.get("output_text") != response["output"][0]["content"][0]["text"]:
                raise AssertionError("responses endpoint output_text did not match message output")
            if int(response["usage"]["output_tokens"]) < 1:
                raise AssertionError("responses endpoint generated no tokens")
            if response.get("inference", {}).get("cache_strategy") != "dynamic":
                raise AssertionError("responses endpoint omitted inference telemetry")

            status, content_type, response_events, response_done = request_sse(base + "/v1/responses", {
                "model": service.model_id,
                "input": [{"role": "user", "content": [{"type": "input_text", "text": "stream response"}]}],
                "max_output_tokens": 3,
                "temperature": 0,
                "stream": True,
            })
            if status != 200 or "text/event-stream" not in content_type or not response_done:
                raise AssertionError("responses streaming did not complete as SSE")
            event_types = [event.get("type") for event in response_events]
            if not event_types or event_types[0] != "response.created" or event_types[-1] != "response.completed":
                raise AssertionError("responses stream missing created/completed lifecycle events")
            if "response.output_text.delta" not in event_types or "response.output_text.done" not in event_types:
                raise AssertionError("responses stream missing output-text events")
            completed = response_events[-1]["response"]
            if int(completed["usage"]["output_tokens"]) < 1 or completed.get("inference", {}).get("cache_strategy") != "dynamic":
                raise AssertionError("responses completed event omitted usage or inference telemetry")
            status, structured = request_json(base + "/v1/chat/completions", {
                "model": service.model_id,
                "messages": [{"role": "user", "content": "choose a mode"}],
                "max_tokens": 80,
                "temperature": 0,
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "mode",
                        "strict": True,
                        "schema": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "mode": {"type": "string", "enum": ["RESPOND", "TOOLS"]},
                                "approved": {"type": "boolean"}
                            },
                            "required": ["mode", "approved"]
                        }
                    }
                }
            })
            if status != 200 or structured.get("structured") is not True:
                raise AssertionError("structured chat endpoint failed")
            parsed = json.loads(structured["choices"][0]["message"]["content"])
            if parsed.get("mode") not in {"RESPOND", "TOOLS"} or not isinstance(parsed.get("approved"), bool):
                raise AssertionError("structured response violated schema")

            quantized = ForgeNativeService(td, quantization="dynamic-int8")
            qhealth = quantized.health()
            if qhealth["quantization"]["mode"] != "dynamic-int8":
                raise AssertionError("dynamic-int8 health truth is missing")
            qchat = quantized.chat({
                "model": quantized.model_id,
                "messages": [{"role": "user", "content": "hello"}],
                "max_tokens": 1,
                "temperature": 0,
            })
            if qchat["usage"]["completion_tokens"] < 1:
                raise AssertionError("dynamic-int8 inference produced no token")

            seeded_payload = {
                "model": service.model_id,
                "messages": [{"role": "user", "content": "seeded reproducibility"}],
                "max_tokens": 5,
                "temperature": 0.9,
                "top_p": 0.9,
                "seed": 424242,
            }
            seeded_a = service.chat(seeded_payload)
            seeded_b = service.chat(seeded_payload)
            if seeded_a["choices"][0]["message"]["content"] != seeded_b["choices"][0]["message"]["content"]:
                raise AssertionError("identical seeded chat requests were not reproducible")
            if seeded_a["inference"].get("seed") != 424242 or seeded_b["inference"].get("seed") != 424242:
                raise AssertionError("seeded inference telemetry omitted the requested seed")
            response_seed = service._responses_payload_to_chat({
                "model": service.model_id,
                "input": "seed response",
                "seed": 77,
            })
            if response_seed.get("seed") != 77:
                raise AssertionError("responses API did not propagate seed")

            gate_service = ForgeNativeService(td, max_concurrent=1, queue_timeout_seconds=0.01)
            held = gate_service._acquire_inference_slot()
            rejected = False
            try:
                try:
                    gate_service._acquire_inference_slot()
                except InferenceBusy:
                    rejected = True
            finally:
                gate_service._release_inference_slot(held, success=True)
            if not rejected:
                raise AssertionError("bounded inference gate did not reject a saturated queue")
            gate_runtime = gate_service.health()["inference_runtime"]
            if int(gate_runtime.get("rejected", 0)) < 1 or int(gate_runtime.get("active", -1)) != 0:
                raise AssertionError("bounded inference metrics did not record rejection/release")

            busy_service = ForgeNativeService(td, max_concurrent=1, queue_timeout_seconds=0.01)
            busy_server = make_server(busy_service, "127.0.0.1", 0)
            busy_thread = threading.Thread(target=busy_server.serve_forever, daemon=True)
            busy_thread.start()
            busy_base = f"http://127.0.0.1:{busy_server.server_port}"
            held_busy = busy_service._acquire_inference_slot()
            try:
                busy_status, busy_payload = request_error_json(busy_base + "/v1/chat/completions", {
                    "model": busy_service.model_id,
                    "messages": [{"role": "user", "content": "busy test"}],
                    "max_tokens": 1,
                    "temperature": 0,
                })
                if busy_status != 503:
                    raise AssertionError("saturated ForgeNative HTTP endpoint did not return 503")
                busy_error = busy_payload.get("error") or {}
                if busy_error.get("code") != "inference_busy" or busy_error.get("retryable") is not True:
                    raise AssertionError("saturated ForgeNative HTTP endpoint did not return retryable inference_busy")
            finally:
                busy_service._release_inference_slot(held_busy, success=True)
                busy_server.shutdown()
                busy_server.server_close()
                busy_thread.join(timeout=5)

            stream_service = ForgeNativeService(td, max_concurrent=1, queue_timeout_seconds=0.1)
            stream_events = list(stream_service.stream_chat({
                "model": stream_service.model_id,
                "messages": [{"role": "user", "content": "stream gate release"}],
                "max_tokens": 1,
                "temperature": 0,
            }))
            if not any(event.get("usage") for event in stream_events):
                raise AssertionError("bounded stream did not emit final usage")
            stream_runtime = stream_service.health()["inference_runtime"]
            if int(stream_runtime.get("active", -1)) != 0 or int(stream_runtime.get("completed", 0)) < 1:
                raise AssertionError("bounded stream did not release its inference slot")

            cache_payload = {
                "model": service.model_id,
                "messages": [{"role": "user", "content": "cache equivalence"}],
                "max_tokens": 3,
                "temperature": 0,
            }
            cached_chat = service.chat(dict(cache_payload, cache_strategy="dynamic"))
            static_chat = service.chat(dict(cache_payload, cache_strategy="static"))
            uncached_chat = service.chat(dict(cache_payload, cache_strategy="none"))
            if cached_chat["choices"][0]["message"]["content"] != static_chat["choices"][0]["message"]["content"]:
                raise AssertionError("dynamic and static-cache greedy API output differed")
            if cached_chat["choices"][0]["message"]["content"] != uncached_chat["choices"][0]["message"]["content"]:
                raise AssertionError("dynamic and no-cache greedy API output differed")
            if static_chat["inference"].get("cache_strategy") != "static":
                raise AssertionError("static-cache API response did not report its strategy")
            static_kv = static_chat["inference"].get("kv_cache") or {}
            if int(static_kv.get("peak_bytes", 0)) <= 0:
                raise AssertionError("static-cache API response reported no allocated KV-cache bytes")
            if uncached_chat["inference"].get("cache_strategy") != "none":
                raise AssertionError("no-cache API response did not report its strategy")
            uncached_kv = uncached_chat["inference"].get("kv_cache") or {}
            if int(uncached_kv.get("peak_bytes", -1)) != 0 or int(uncached_kv.get("final_bytes", -1)) != 0:
                raise AssertionError("no-cache API response reported non-zero KV-cache bytes")
            response_cache = service._responses_payload_to_chat({
                "model": service.model_id,
                "input": "cache response",
                "cache_strategy": "none",
            })
            if response_cache.get("cache_strategy") != "none":
                raise AssertionError("responses API did not propagate cache_strategy")

        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
    print("ForgeNative localhost server smoke test: PASS")


if __name__ == "__main__":
    main()
