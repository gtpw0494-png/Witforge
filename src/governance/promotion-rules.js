export const PROTECTED_GOVERNANCE_RULES=Object.freeze([
"source-promotion-authority","secret-access-authority","audit-integrity","data-deletion",
"plugin-execution-boundary","maximum-autonomy-limits","emergency-stop","training-consent",
"protected-branch","evidence-verification"
]);
export function governanceChangeClass(changes=[]){
  const touched=[...new Set((changes||[]).map(String).filter(x=>PROTECTED_GOVERNANCE_RULES.includes(x)))];
  return {state:"SUCCESS",protected:touched.length>0,touched,requiresSeparateLocalAuthority:touched.length>0};
}
