# UAI Model Support

UAI separates model registration from runtime availability.

## Current model paths

### ForgeLM
Local PyTorch research model with:
- causal decoder architecture;
- train/save/load;
- tokenizer fallback;
- KV-cache inference;
- optional MoE/future-token objectives;
- CPU CI verification.

### llama.cpp
Local OpenAI-compatible runtime adapter. Localhost is allowed by default; remote endpoints are blocked unless explicitly enabled.

### Registry-only / runtime-conditional
The model registry may describe Ollama, Transformers, ONNX or GGUF artifacts without claiming those runtimes are connected.

## v0.49 runtime router

The current router is implemented in `src/models/router.js`.

Verified today:
- candidate `health()` probing;
- connected-runtime filtering;
- local-only and offline constraints;
- task/modality/context constraints;
- deterministic candidate scoring;
- generation fallback after runtime failure or rejected output;
- route/fallback evidence attached to native OneChat replies;
- local llama.cpp and ForgeLM candidate adapters.

The broader provider contract still needs convergence for `stream()`, `embed()`, `countTokens()` and richer capability discovery. Those are not claimed complete by v0.49.

## Model routing inputs

The current router considers:
- required capability;
- privacy classification;
- local-only policy;
- latency/resource budget;
- declared context/latency constraints;
- optional model evaluation evidence;
- fallback reason.

Every model call should record model/provider/version, prompt version, tokenization metadata, runtime parameters and latency.

## Training posture

Verified today:
- small local ForgeLM training;
- deterministic dataset construction;
- replay/regression foundations.

Partial/unavailable:
- production-scale distributed pretraining;
- LoRA/QLoRA/DPO execution;
- multimodal training;
- federated/private learning.

Those remain explicitly truth-gated.
