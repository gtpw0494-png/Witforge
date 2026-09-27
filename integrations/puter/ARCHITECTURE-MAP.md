# Puter integration boundary

WitForge keeps Puter optional. The pinned upstream reference is `HeyPuter/puter@922d203e18e1946c83dca2fe3b179010fde0480c` (AGPL-3.0-only).

Adapted concepts: provider abstraction, chat-completion driver shape, Ollama-style provider separation, and normalized provider responses. Runtime calls use Puter's documented OpenAI-compatible endpoint when `PUTER_AUTH_TOKEN` is configured.

Puter never becomes WitForge's authorization authority. Model/provider output is proposal/data only; WitForge policy, approval, capability truth, verification and audit remain authoritative. No Puter token is stored in source or browser state.
