# Capability Recovery — v0.25.0

## Protected checkpoint
v0.24.0 is the chat-working checkpoint. v0.25 is additive and must not delete or reset v0.24 knowledge, state, datasets, checkpoints, tokenizers or model runs.

## Why v0.24 showed 29/42 on Termux
The 13 non-CONNECTED slots were:

1. `local.forgelm.trainer.v2` — PyTorch absent.
2. `local.forgelm.infer` — PyTorch/model runtime absent.
3. `local.forgelm.train` — PyTorch absent.
4. `local.langgraph.orchestration` — LangGraph absent.
5. `billing.live.read` — no live billing credential/adapter connection.
6. `reference.oxford.compare` — no legitimate Oxford API credentials/data.
7. `physical.matter.fabricate` — no verified fabrication controller/hardware.
8-13. Six legacy external provider-chat API slots — not aligned with the current ForgeLM source-research goal and normally unavailable without API keys.

## v0.25 recovery
The six provider-chat slots in the *core 42* are replaced with six governed source/research capabilities:

- `research.openai.gpt_oss`
- `research.xai.grok1`
- `research.deepseek.v3`
- `research.google.gemma`
- `research.huggingface.transformers`
- `research.anthropic.public`

The original optional provider API adapters remain available outside the core 42 for compatibility. Anthropic public research is not represented as Claude model source.

Expected baseline: **35/42 CONNECTED** without PyTorch, LangGraph, Oxford/Stripe credentials or fabrication hardware.

## Termux-local recovery to 39/42
Current Termux package metadata includes `python-torch`. Run:

```bash
./scripts/enable-termux-capabilities.sh
```

The script installs:

```text
python
python-numpy
python-torch
nodejs
git
@langchain/langgraph@1.4.17
@langchain/core@1.2.12
zod@4.6.5
```

After successful imports/checkpoint inspection, these four capabilities can become CONNECTED:

- `local.forgelm.trainer.v2`
- `local.forgelm.infer`
- `local.forgelm.train`
- `local.langgraph.orchestration`

Expected local target: **39/42 CONNECTED**.

## Stripe live billing — target 40/42
The adapter implements Stripe's live subscription-list endpoint. Configure a legitimate server-side key, restart the server, then probe:

```bash
export STRIPE_SECRET_KEY='...'
npm start
# second Termux session:
npm run capabilities:probe
```

The capability is CONNECTED only after a successful live API response.

## Oxford comparison — target 41/42
The Oxford Dictionaries API requires `app_id` and `app_key`. The adapter supports production or sandbox mode:

```bash
export OXFORD_APP_ID='...'
export OXFORD_APP_KEY='...'
export OXFORD_SANDBOX=1   # optional
```

The sandbox probe defaults to `ace`, compatible with Oxford's sandbox first-letter constraint. No Oxford content is bundled or fabricated.

## Physical fabrication — target 42/42
v0.25 implements an OctoPrint adapter for a real printer/controller. Configure:

```bash
export OCTOPRINT_URL='http://printer-host:5000'
export OCTOPRINT_API_KEY='...'
export FABRICATION_ENABLE=1
```

The app probes `/api/version` and `/api/connection`. It becomes CONNECTED only if the controller is reachable and the printer reports an operational/printing/paused state. Start/cancel/restart job commands require explicit approval in the API call.

## Truth rule
Code existence alone never turns an external capability green. Local source-research capabilities can be CONNECTED from the governed local registry; neural dependencies require importable runtimes; network services require successful probes; physical fabrication requires actual verified hardware.
