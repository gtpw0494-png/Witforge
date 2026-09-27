import assert from "node:assert/strict";
import { OneChatRouter } from "../src/onechat.js";

const calls=[];
const approvalStore={
  request:binding=>({id:"approval-model-1",status:"PENDING",...binding}),
  validate:(id,binding)=>id==="approval-model-1"?{state:"SUCCESS",approval:{id},binding}:{state:"DENIED",message:"bad approval"}
};
const modelLab={
  evaluateCandidate:async(runId,opts)=>{calls.push(["evaluate",runId,opts]);return{state:"SUCCESS",runId,eligible:true};},
  promoteCandidate:(runId,opts)=>{calls.push(["promote",runId,opts]);return{state:"SUCCESS",runId,promoted:true};},
  rollback:(runId,opts)=>{calls.push(["rollback",runId,opts]);return{state:"SUCCESS",runId,rolled_back:true};},
  status:()=>({state:"SUCCESS",candidateFirst:true})
};
const router=new OneChatRouter({
  modelLab,
  approvalStore,
  forgelm:{status:async()=>({state:"SUCCESS",checkpointExists:true}),chat:async()=>({state:"SUCCESS",text:"x"})}
});

assert.equal(router.allocations("promote model run model-run-abc")[0].agent,"forgelm");
let out=await router.execute("forgelm","evaluate model run model-run-abc threshold 0.01","chat",{ownerId:"owner-1"});
assert.equal(out.state,"SUCCESS");
assert.equal(calls.at(-1)[0],"evaluate");
assert.equal(calls.at(-1)[2].maxRelativeRegression,0.01);

out=await router.execute("forgelm","promote model run model-run-abc","chat",{ownerId:"owner-1"});
assert.equal(out.state,"ASK");
assert.equal(out.approval.operation,"onechat.model.promote");

out=await router.execute("forgelm","promote model run model-run-abc approval approval-model-1","chat",{ownerId:"owner-1"});
assert.equal(out.state,"SUCCESS");
assert.equal(calls.at(-1)[0],"promote");
assert.equal(calls.at(-1)[2].approvalId,"approval-model-1");

out=await router.execute("forgelm","rollback model run model-run-abc reason regression approval approval-model-1","chat",{ownerId:"owner-1"});
assert.equal(out.state,"SUCCESS");
assert.equal(calls.at(-1)[0],"rollback");
assert.equal(calls.at(-1)[2].reason,"regression");

console.log("onechat model lifecycle: ok");
