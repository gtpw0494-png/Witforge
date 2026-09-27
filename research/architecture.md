# ForgeLM architecture research boundary

ForgeLM is an original local implementation. Public/open repositories are kept as inspectable references, with provenance and license metadata, instead of being blindly concatenated into a single codebase.

Implemented and tested: decoder-only causal language modeling, RMSNorm, RoPE, grouped-query attention, SwiGLU, optional sparse MoE, byte/action tokens, train/save/load, verified-trace data fabric, and incremental KV-cache generation.

The architecture matrix (`architecture_matrix.json`) records whether an observed technique is adopted, experimental, or research-only. Promotion requires an independently implemented change plus local tests/benchmarks. This keeps the project able to learn from gpt-oss, Grok-1, DeepSeek, Gemma and general Transformers research without falsely claiming proprietary internals or silently importing incompatible code.
