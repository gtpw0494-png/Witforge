import assert from "node:assert/strict";
import { routeSecurity } from "../src/governance/authorization.js";
import { validateRequestBody } from "../src/governance/request-schemas.js";

let r=routeSecurity("POST","/api/knowledge/learning/train");
assert.equal(r.capability,"knowledge.write");assert.equal(r.risk,"high");
r=routeSecurity("POST","/api/knowledge/model/promote");
assert.equal(r.risk,"high");
r=routeSecurity("POST","/api/knowledge/model/rollback");
assert.equal(r.risk,"high");
r=routeSecurity("POST","/api/knowledge/research/schedule");
assert.equal(r.risk,"high");assert.equal(r.external,true);
r=routeSecurity("POST","/api/knowledge/research/run");
assert.equal(r.external,true);

assert.equal(validateRequestBody("POST","/api/knowledge/learning/evaluate",{}).state,"BLOCKED");
assert.equal(validateRequestBody("POST","/api/knowledge/learning/evaluate",{jobId:"j1"}).state,"SUCCESS");
assert.equal(validateRequestBody("POST","/api/knowledge/model/promote",{jobId:"j1"}).state,"BLOCKED");
assert.equal(validateRequestBody("POST","/api/knowledge/model/promote",{jobId:"j1",approvalId:"a1"}).state,"SUCCESS");
assert.equal(validateRequestBody("POST","/api/knowledge/research/run",{topic:"ai safety"}).state,"SUCCESS");
console.log("knowledge governance boundary: ok");

let modelRoute=routeSecurity("POST","/api/model/promote");
assert.equal(modelRoute.risk,"high");
modelRoute=routeSecurity("POST","/api/model/rollback");
assert.equal(modelRoute.risk,"high");
assert.equal(validateRequestBody("POST","/api/model/evaluate",{}).state,"BLOCKED");
assert.equal(validateRequestBody("POST","/api/model/evaluate",{runId:"model-run-1"}).state,"SUCCESS");
assert.equal(validateRequestBody("POST","/api/model/promote",{runId:"model-run-1"}).state,"BLOCKED");
assert.equal(validateRequestBody("POST","/api/model/promote",{runId:"model-run-1",approvalId:"approval-1"}).state,"SUCCESS");
assert.equal(validateRequestBody("POST","/api/model/rollback",{runId:"model-run-1",approvalId:"approval-1",reason:"regression"}).state,"SUCCESS");

let cloudRoute=routeSecurity("POST","/api/knowledge/cloud/sync");
assert.equal(cloudRoute.risk,"high");
assert.equal(cloudRoute.external,true);
assert.equal(cloudRoute.requiresCredential,true);
assert.equal(validateRequestBody("POST","/api/knowledge/cloud/sync",{limit:500}).state,"SUCCESS");
