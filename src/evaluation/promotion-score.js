export function promotionScore({tests=false,security=false,privacy=false,rollback=false,provenance=false,critic=false,performanceWithinBudget=false}={}){
  const checks={tests,security,privacy,rollback,provenance,critic,performanceWithinBudget},missing=Object.entries(checks).filter(([,v])=>v!==true).map(([k])=>k);
  return {state:missing.length?"BLOCKED":"SUCCESS",eligible:missing.length===0,checks,missing,score:Object.values(checks).filter(Boolean).length/Object.keys(checks).length,message:missing.length?"Promotion evidence is incomplete.":"All promotion evidence gates are satisfied; separate promotion authority is still required."};
}
