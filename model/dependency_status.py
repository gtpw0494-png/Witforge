#!/usr/bin/env python3
import importlib.util,json,platform,sys
mods={"torch":"torch","numpy":"numpy","safetensors":"safetensors","sentencepiece":"sentencepiece","lightning":"lightning","transformers":"transformers","tokenizers":"tokenizers","datasets":"datasets","accelerate":"accelerate","peft":"peft","trl":"trl","langchain":"langchain","langgraph":"langgraph","jax":"jax","flax":"flax","optax":"optax","torchlight":"torchlight"}
out={k:("CONNECTED" if importlib.util.find_spec(v) else "UNAVAILABLE") for k,v in mods.items()}
print(json.dumps({"state":"SUCCESS","python":sys.version.split()[0],"platform":platform.platform(),"dependencies":out}))
