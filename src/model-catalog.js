// Canonical catalog for model selection. Catalog entries are capabilities and routing metadata;
// they never imply that a model is installed, licensed, reachable, or production-approved.
const entry=(id,provider,kind,capabilities,aliases=[],meta={})=>({id,provider,kind,capabilities,aliases,status:"REGISTRY_ONLY",...meta});
export const MODEL_CATALOG=[
 entry("gpt-6-astra","openai","frontier",["chat","code","reasoning","vision","tools","structured-output"],["gpt-6","GPT-6 Astra","openai/gpt-6-astra"],{contextTokens:1_000_000,maxOutputTokens:128_000}),
 entry("gpt-5.3-codex","openai","code",["chat","code","reasoning","tools","structured-output"],["astra-gpt-5.3","GPT-5.3 Codex","openai/gpt-5.3-codex"],{contextTokens:128_000,maxOutputTokens:128_000}),
 entry("gpt-5-nano","openai","fallback",["chat","code","structured-output"],["puter-default","GPT-5 Nano","openai/gpt-5-nano"]),
 entry("gpt-image-2.5-flare","openai","image",["image","image-edit"],["GPT Image 2.5 Flare","openai/gpt-image-2.5-flare"]),
 entry("gpt-image-2.5-sunburst","openai","image",["image","image-edit"],["GPT Image 2.5 Sunburst","openai/gpt-image-2.5-sunburst"]),
 entry("claude-sonnet-5","anthropic","frontier",["chat","code","reasoning","vision","tools","structured-output"],["Claude Sonnet 5","anthropic/claude-sonnet-5"]),
 entry("claude-opus-4.8","anthropic","frontier",["chat","code","reasoning","vision","tools","structured-output"],["Claude Opus 4.8","anthropic/claude-opus-4.8"]),
 entry("gemini-3.8-flash","gemini","chat",["chat","code","reasoning","vision","tools","structured-output","audio","video","pdf"],["Gemini 3.8 Flash","google/gemini-3.8-flash"],{contextTokens:1_000_000,maxOutputTokens:64_000}),
 entry("gemini-3.7-flash","gemini","chat",["chat","code","reasoning","vision","tools","structured-output"],["Gemini 3.7 Flash","google/gemini-3.7-flash"]),
 entry("gemini-3.1-pro","gemini","frontier",["chat","code","reasoning","vision","tools","structured-output"],["Gemini 3.1 Pro","google/gemini-3.1-pro"]),
 entry("gemini-3.1-flash-image","gemini","image",["image","image-edit","vision"],["Gemini 3.1 Flash Image","google/gemini-3.1-flash-image"]),
 entry("gemini-3-pro-image","gemini","image",["image","image-edit","vision"],["Gemini 3 Pro Image","google/gemini-3-pro-image"]),
 entry("nano-banana","gemini","image",["image","image-edit","vision"],["Nano Banana","google/nano-banana"]),
 entry("grok-4.7","xai","frontier",["chat","code","reasoning","vision","tools","structured-output"],["Grok 4.7","x-ai/grok-4.7"]),
 entry("grok-4.6","xai","frontier",["chat","code","reasoning","vision","tools","structured-output"],["Grok 4.6","x-ai/grok-4.6"]),
 entry("grok-4.5","xai","chat",["chat","code","reasoning","tools"],["Grok 4.5","x-ai/grok-4.5"]),
 entry("grok-imagine-image","xai","image",["image","image-edit"],["Grok Imagine Image","x-ai/grok-imagine-image"]),
 entry("command-a-plus","cohere","moe",["chat","code","reasoning","vision","tools","structured-output","multilingual"],["Command A+","cohere/command-a-plus"]),
 entry("command-a","cohere","chat",["chat","code","tools"],["Command A","cohere/command-a"]),
 entry("north-mini-code","cohere","code",["code","tools","reasoning"],["North Mini Code","cohere/north-mini-code:free"],{contextTokens:256_000,maxOutputTokens:64_000}),
 entry("schematron-v2-small","inference","specialty",["structured-output","json"],["Schematron V2 Small"]),
 entry("schematron-v2-turbo","inference","specialty",["structured-output","html","json"],["Schematron V2 Turbo"]),
 entry("ling-3.0-flash-vl","inference","vision",["vision","chat"],["Ling 3.0 Flash VL"]),
 entry("mercury-2.5","inference","diffusion",["chat","diffusion-tokens"],["Mercury 2.5"]),
 entry("minimax-m3","minimax","chat",["chat","code","reasoning","vision","tools"],["MiniMax M3","minimax/minimax-m3"]),
 entry("minimax-m2.7","minimax","chat",["chat","code","reasoning"],["MiniMax M2.7"]),
 entry("minimax-m2.7-highspeed","minimax","fast",["chat","code"],["MiniMax M2.7 Highspeed"]),
 ...[
  ["llama","huggingface"],["muse","huggingface"],["flux-schnell","huggingface"],["qwen","huggingface"],["mistral","huggingface"],["deepseek-v4.1-flash","deepseek"],["deepseek-r1","deepseek"],["phi","huggingface"],["kimi","custom"],["glm","custom"],["byteplus","custom"],["nous","huggingface"]
 ].map(([id,provider])=>entry(id,provider,"open-ecosystem",["chat","code"]))
];
export function findModels(query=""){const q=String(query).toLowerCase();return MODEL_CATALOG.filter(x=>!q||[x.id,x.provider,...x.aliases].join(" ").toLowerCase().includes(q));}
export function modelCatalogStatus(){return {state:"SUCCESS",models:MODEL_CATALOG.map(x=>({...x,availability:"PROBED_AT_RUNTIME"}))};}
