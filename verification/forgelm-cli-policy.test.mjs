import assert from "node:assert/strict";
import fs from "node:fs";

const source=fs.readFileSync(new URL("../model/cli.py",import.meta.url),"utf8");
assert.match(source,/trainingPolicy["']?\s*:\s*["']CANDIDATE_FIRST["']/);
assert.match(source,/candidateCheckpoint/);
assert.match(source,/productionEligible["']?\s*:\s*False/);
assert.doesNotMatch(source,/ForgeLM\.load\(r\[['"]modelCheckpoint['"]\]\)\.save\(CKPT/);
assert.doesNotMatch(source,/promotedCheckpoint/);
console.log("forgelm CLI candidate-first policy: ok");
