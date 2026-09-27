# Language Intelligence v0.27-v0.30

The lexical graph stores WordNet synset pointers separately from definitions. Dialogue style labels are deterministic local features, not human psychological labels. Semantic retrieval uses signed feature hashing over tokens and bigrams with cosine similarity; it is dependency-free and explicitly non-neural. The tokenizer byte/action fallback no longer imports PyTorch, so tokenizer status remains usable even when Torch is unavailable on Termux.
