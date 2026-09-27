import assert from "node:assert/strict";
import {MODEL_CATALOG,findModels} from "../src/model-catalog.js";
import {providerDefinitions} from "../src/providers.js";

const providers=new Set(providerDefinitions().map(x=>x.id));
for(const model of MODEL_CATALOG) assert.ok(providers.has(model.provider),`${model.id} has no provider`);

for(const id of ["gpt-6-astra","gpt-5.3-codex","gpt-5-nano","claude-sonnet-5","claude-opus-4.8","gemini-3.7-flash","gemini-3.1-pro","grok-4.6","command-a-plus","north-mini-code","schematron-v2-small","minimax-m3","flux-schnell","qwen","deepseek-r1"])
  assert.equal(findModels(id)[0]?.id,id);

assert.equal(findModels("GPT-6 Astra")[0]?.id,"gpt-6-astra");
assert.equal(findModels("GPT-5.3 Codex")[0]?.id,"gpt-5.3-codex");
assert.equal(findModels("openai/gpt-6-astra")[0]?.contextTokens,1_000_000);
assert.equal(findModels("North Mini Code")[0]?.maxOutputTokens,64_000);
assert.ok(MODEL_CATALOG.some(x=>x.capabilities.includes("image")));
assert.ok(MODEL_CATALOG.some(x=>x.capabilities.includes("structured-output")));
console.log(`model catalog verification passed (${MODEL_CATALOG.length} entries)`);
