import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const brainMod = require('../brain.js');
const prompts = [];

const brain = brainMod.create({
  llmChat: async args => {
    prompts.push(String(args.prompt || ''));
    return { ok:true, provider:'stub', model:'stub-chat', reply:'ack ' + prompts.length };
  },
  runCommand: async () => ({ ok:true, reply:'ok' }),
  stateBrief: () => 'state=ok',
  skillCatalog: () => 'Core:\n• “help” — show help',
  scrubSecrets: () => ({ redactions:0 }),
  audit: () => {}
});

await brain.converse('alpha first turn', { scope:'chat-alpha' });
await brain.converse('beta first turn', { scope:'chat-beta' });
assert.equal(brain.history('chat-alpha'), 1);
assert.equal(brain.history('chat-beta'), 1);
assert.deepEqual(new Set(brain.scopes()), new Set(['chat-alpha','chat-beta']));

await brain.converse('alpha second turn', { scope:'chat-alpha' });
const alphaPrompt = prompts.at(-1);
assert.match(alphaPrompt, /alpha first turn/);
assert.doesNotMatch(alphaPrompt, /beta first turn/);

await brain.converse('beta second turn', { scope:'chat-beta' });
const betaPrompt = prompts.at(-1);
assert.match(betaPrompt, /beta first turn/);
assert.doesNotMatch(betaPrompt, /alpha first turn/);

brain.clearHistory('chat-alpha');
assert.equal(brain.history('chat-alpha'), 0);
assert.equal(brain.history('chat-beta'), 2);

console.log('Conversation scope isolation passed.');
