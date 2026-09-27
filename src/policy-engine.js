import crypto from "node:crypto";
const DECISIONS=new Set(["ALLOW","DENY","ASK","ESCALATE","BLOCK"]);
const stable=v=>Array.isArray(v)?`[${v.map(stable).join(",")}]`:v&&typeof v==="object"?`{${Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+stable(v[k])).join(",")}}`:JSON.stringify(v);
const sha=v=>crypto.createHash("sha256").update(typeof v==="string"?v:stable(v)).digest("hex");
function signDecision(payload){
  const pem=String(process.env.IUV_POLICY_SIGNING_KEY||"").trim();if(!pem)return {mode:"UNSIGNED_LOCAL",digest:sha(payload),signature:null,publicKeyFingerprint:null};
  try{const key=crypto.createPrivateKey(pem),pub=crypto.createPublicKey(key),signature=crypto.sign(null,Buffer.from(sha(payload),"hex"),key).toString("base64"),fingerprint=crypto.createHash("sha256").update(pub.export({type:"spki",format:"der"})).digest("hex");return {mode:"ED25519",digest:sha(payload),signature,publicKeyFingerprint:fingerprint};}
  catch{return {mode:"SIGNING_KEY_INVALID",digest:sha(payload),signature:null,publicKeyFingerprint:null};}
}
export class PolicyEngine{
  evaluate({operation="",risk="low",external=false,physical=false,mutatesSource=false,requiresCredential=false,actor=null,resource=null,arguments:args={},dataClassification="local",destination=null,policySource="local-kernel",expiresAt=null}={}){
    const r=String(risk||"low").toLowerCase(),riskFactors=[];
    if(external)riskFactors.push("external-transfer");
    if(physical)riskFactors.push("physical-world");
    if(mutatesSource)riskFactors.push("source-mutation");
    if(requiresCredential)riskFactors.push("credential-use");
    if(["restricted","secret","sensitive"].includes(String(dataClassification).toLowerCase()))riskFactors.push("sensitive-data");
    let decision="ALLOW",reason="Low-risk local operation is allowed within declared capability scope.";
    if(physical){decision="ASK";reason="Physical-world execution requires explicit human approval and a verified connected adapter.";}
    else if(mutatesSource){decision="ASK";reason="Source mutation requires proposal-bound explicit approval plus snapshot/verification.";}
    else if(r==="critical"){decision="ESCALATE";reason="Critical-risk operation requires stronger human authorization before execution.";}
    else if(r==="high"){decision="ASK";reason="High-risk operation requires explicit approval.";}
    else if(requiresCredential&&external){decision="ASK";reason="Credentialed external action requires explicit authorized scope.";}
    else if(external&&["restricted","secret"].includes(String(dataClassification).toLowerCase())){decision="ASK";reason="External transfer of restricted data requires explicit approval.";}
    if(!DECISIONS.has(decision))decision="BLOCK";
    const payload={policyVersion:"uai-policy-v0.54",decision,reason,operation:String(operation),risk:r,actor:actor?String(actor):null,resource:resource?String(resource):null,argumentsHash:sha(args||{}),dataClassification:String(dataClassification||"local"),destination:destination?String(destination):null,riskFactors,expiry:expiresAt||null,policySource:String(policySource||"local-kernel")};
    return {state:"SUCCESS",...payload,proof:signDecision(payload)};
  }
}
