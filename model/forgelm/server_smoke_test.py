from __future__ import annotations

import json
from pathlib import Path
import tempfile
import threading
from urllib.request import Request, urlopen

from .checkpoint import save_checkpoint
from .configuration_forgelm import ForgeLMConfig
from .modeling_forgelm import ForgeLMForCausalLM
from .server import ForgeNativeService, make_server
from .tokenizer import ByteTokenizer


def request_json(url: str, body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = Request(url, data=data, headers={"Content-Type": "application/json"} if data else {}, method="POST" if data else "GET")
    with urlopen(req, timeout=10) as res:
        return res.status, json.loads(res.read().decode("utf-8"))


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
            status, models = request_json(base + "/v1/models")
            if status != 200 or not models.get("data"):
                raise AssertionError("models endpoint returned no model")
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
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
    print("ForgeNative localhost server smoke test: PASS")


if __name__ == "__main__":
    main()
