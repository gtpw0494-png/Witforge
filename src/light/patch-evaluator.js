const ok=x=>x===true||x?.state==="SUCCESS"||x?.passed===true;
export class PatchEvaluator{
  evaluate({tests=[],security=null,shadowReview=null,changedFiles=[],dependencies=[],risk="medium",evidence=[]}={}){
    const testRows=Array.isArray(tests)?tests:[tests],testsOk=testRows.length>0&&testRows.every(ok),securityOk=ok(security),shadowOk=ok(shadowReview);
    const blockers=[];if(!testsOk)blockers.push("tests");if(!securityOk)blockers.push("security");if(!shadowOk)blockers.push("shadowReview");
    if(!Array.isArray(changedFiles)||!changedFiles.length)blockers.push("changedFiles");
    return {state:blockers.length?"BLOCKED":"SUCCESS",eligible:!blockers.length,checks:{tests:testsOk,security:securityOk,shadowReview:shadowOk},blockers,
      evidenceRecord:{changedFiles,tests:testRows,security,shadowReview,risk,dependencies,evidence,evaluatedAt:new Date().toISOString()}};
  }
}
