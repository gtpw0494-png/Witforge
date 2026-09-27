import assert from 'node:assert/strict';
import {ForgeLMBridge} from '../src/forgelm-bridge.js';
const bridge=new ForgeLMBridge();
const status=await bridge.status();
assert.equal(status.selfSufficient,true);
assert.equal(status.networkRequired,false);
assert.ok(status.tasks.includes('code'));
assert.ok(status.tasks.includes('planning'));
console.log('ForgeLM self-sufficient capability contract passed');
