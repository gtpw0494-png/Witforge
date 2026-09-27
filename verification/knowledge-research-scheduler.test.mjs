import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { KnowledgeResearchWorker } from "../src/knowledge-research-worker.js";
import { KnowledgeScheduler } from "../src/knowledge-scheduler.js";

const ingested=[];
const worker=new KnowledgeResearchWorker({
  sources:[{id:"docs",domain:"docs.example",allowed:true,license:"open-docs"}],
  webResearch:{search:async()=>({state:"SUCCESS",results:[
    {url:"https://docs.example/a",title:"A"},
    {url:"https://evil.example/b",title:"B"}
  ]})},
  webCorpus:{ingestUrl:async x=>{ingested.push(x);return{state:"SUCCESS",contentSha256:"a".repeat(64),document:{document:{id:"doc-1"}},trainingEligible:false}}},
  audit:null
});
const out=await worker.researchTopic("topic",{perSource:5,maxSources:5});
assert.equal(out.state,"SUCCESS");
assert.equal(out.evidence_count,1);
assert.equal(ingested.length,1);
assert.equal(ingested[0].promoteTraining,false);
assert.equal(ingested[0].respectRobots,true);

const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-ksched-"));
let runs=0;
const scheduler=new KnowledgeScheduler({stateRoot:root,intervalMs:60000,runner:async topic=>{runs++;return{state:"SUCCESS",topic,stored:1,evidence_count:1}}});
scheduler.configure({topics:["alpha","beta"],enabled:false});
assert.equal(scheduler.status().topics,2);
assert.equal((await scheduler.runOnce()).state,"SUCCESS");
assert.equal(runs,1);
assert.equal(scheduler.status().runs,1);
const reloaded=new KnowledgeScheduler({stateRoot:root,intervalMs:60000,runner:async()=>({state:"SUCCESS"})});
assert.equal(reloaded.status().topics,2);
assert.ok(reloaded.status().last_run);
console.log("knowledge research scheduler: ok");
