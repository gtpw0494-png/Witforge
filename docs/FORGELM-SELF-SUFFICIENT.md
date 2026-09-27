# ForgeLM self-sufficient capability layer

ForgeLM is now treated as UAI's primary intelligence engine. The capability layer does not call OpenAI, Anthropic, Gemini, Grok, Cohere, Puter, or any other model.

Supported local task contracts:

- `chat` — local conversation
- `code` — code generation contract
- `reasoning` — local reasoning contract
- `planning` — deterministic plan and verification structure
- `json` — JSON-only generation plus local validation
- `tool` — approval-gated local tool proposal
- `vision` and `image` — explicitly partial until a local multimodal encoder/decoder is trained and installed

Train and promote ForgeLM locally, then run:

```sh
python3 model/self_sufficient.py status
python3 model/self_sufficient.py code --prompt "write a Python function that reverses a list"
python3 model/self_sufficient.py planning --prompt "build a local document index"
python3 model/self_sufficient.py json --prompt "return an object with name and purpose"
node verification/forgelm-self-sufficient.test.mjs
```

The larger `desktop-reasoning-moe` preset increases local capacity but is not a claim that ForgeLM matches any external frontier model. Capability promotion must be supported by UAI's benchmark and artifact-verification records.
