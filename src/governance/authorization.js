import {validateRequestBody} from "./request-schemas.js";
import crypto from "node:crypto";

const stable=v=>Array.isArray(v)?`[${v.map(stable).join(",")}]`:v&&typeof v==="object"?`{${Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+stable(v[k])).join(",")}}`:JSON.stringify(v);
const sha=v=>crypto.createHash("sha256").update(typeof v==="string"?v:stable(v)).digest("hex");
const cleanBody=body=>{
  const x=body&&typeof body==="object"&&!Array.isArray(body)?{...body}:{};
  delete x.approvalId;delete x.csrfToken;delete x.ownerToken;delete x.token;
  return x;
};

export function routeSecurity(method,path){
  const m=String(method||"GET").toUpperCase(),p=String(path||"");
  if(p==="/api/status"||p==="/api/auth/status"||p==="/api/auth/login")return {public:true,stateChanging:p==="/api/auth/login",capability:"identity.login",risk:"low"};
  const stateChanging=!["GET","HEAD","OPTIONS"].includes(m);
  let risk=stateChanging?"medium":"low",capability="api.read",external=false,mutatesSource=false,requiresCredential=false,delegateApproval=false;
  if(p.startsWith("/api/memory/"))capability=stateChanging?"memory.write":"memory.read";
  else if(p.startsWith("/api/provenance/"))capability=stateChanging?"provenance.write":"provenance.read";
  else if(p.startsWith("/api/evaluations/"))capability=stateChanging?"evaluation.write":"evaluation.read";
  else if(p.startsWith("/api/model-artifacts/"))capability=stateChanging?"models.artifacts.write":"models.artifacts.read";
  else if(p.startsWith("/api/documents/"))capability=stateChanging?"documents.write":"documents.read";
  else if(p.startsWith("/api/models"))capability="models.read";
  else if(p.startsWith("/api/plugins-v1/"))capability=p.endsWith("/execute")?"plugins.execute":"plugins.manage";
  else if(p.startsWith("/api/model/"))capability=stateChanging?"models.execute":"models.read";
  else if(p.startsWith("/api/vision/"))capability=stateChanging?"models.vision.execute":"models.vision.read";
  else if(p.startsWith("/api/audio/"))capability=stateChanging?"models.audio.execute":"models.audio.read";
  else if(p.startsWith("/api/speech/"))capability=stateChanging?"models.speech.execute":"models.speech.read";
  else if(p.startsWith("/api/video/"))capability=stateChanging?"models.video.execute":"models.video.read";
  else if(p.startsWith("/api/multimodal/"))capability=stateChanging?"models.multimodal.execute":"models.multimodal.read";
  else if(p.startsWith("/api/media/"))capability=stateChanging?"media.write":"media.read";
  else if(p.startsWith("/api/tasks/"))capability=stateChanging?"tasks.execute":"tasks.read";
  else if(p.startsWith("/api/approvals"))capability="governance.approvals";
  else if(p.startsWith("/api/autonomy"))capability="governance.autonomy";
  else if(p.startsWith("/api/policy"))capability="governance.policy";
  else if(p.startsWith("/api/selfdev"))capability="source.selfdev";
  else if(p.startsWith("/api/shadow/"))capability=stateChanging?"shadow.execute":"shadow.read";
  else if(p.startsWith("/api/light/"))capability=stateChanging?"light.execute":"light.read";
  else if(p.startsWith("/api/control-plane/"))capability=stateChanging?"agents.schedule":"agents.schedule.read";
  else if(p.startsWith("/api/promotion/"))capability="governance.promotion";
  else if(p.startsWith("/api/governance/"))capability=stateChanging?"governance.manage":"governance.read";
  else if(p.startsWith("/api/platform/"))capability="platform.read";
  else if(p.startsWith("/api/develop")||p.startsWith("/api/source/"))capability="source.modify";
  else if(p.startsWith("/api/web/")||p.startsWith("/api/provider/"))capability="external.research";
  else if(p.startsWith("/api/fabrication"))capability="hardware.fabrication";
  else if(p.startsWith("/api/onechat")||p.startsWith("/api/chat"))capability="onechat.invoke";
  else if(p.startsWith("/api/knowledge"))capability=stateChanging?"knowledge.write":"knowledge.read";
  else if(p.startsWith("/api/accounts")||p.startsWith("/api/subscriptions")||p.startsWith("/api/billing"))capability="accounts.manage";

  if(/\/purge$|\/forget-source$|\/source\/rollback$|\/model\/train$|\/model\/tokenizer\/train$|\/model\/(?:promote|rollback)$|\/vision\/(?:promote|rollback)$|\/audio\/(?:promote|rollback)$|\/speech\/(?:promote|rollback)$|\/video\/(?:promote|rollback)$|\/knowledge\/learning\/train$|\/knowledge\/model\/(?:promote|rollback)$|\/knowledge\/research\/schedule$|\/knowledge\/cloud\/(?:recover|sync)$|\/selfdev\/promote$|\/develop\/apply$|\/fabrication\/job$|\/autonomy\/grant$|^\/api\/promotion\/|\/governance\/emergency\/release$|\/governance\/trusted-devices\/(?:enroll|revoke)$/.test(p))risk="high";
  if(/\/fabrication\/job$/.test(p))risk="critical";
  if(["/api/develop/apply","/api/selfdev/promote","/api/source/rollback"].includes(p))mutatesSource=true;
  if(p.startsWith("/api/web/")||p.startsWith("/api/provider/")||p.startsWith("/api/billing/")||p.startsWith("/api/oxford/")||p.startsWith("/api/fabrication/")||p.startsWith("/api/knowledge/research")||p.startsWith("/api/knowledge/cloud/")||p.endsWith("/execute"))external=true;
  if(p.startsWith("/api/billing/")||p.startsWith("/api/oxford/")||p.startsWith("/api/fabrication/")||p.startsWith("/api/provider/")||p.startsWith("/api/knowledge/cloud/"))requiresCredential=true;
  if(["/api/plugins-v1/execute","/api/develop/apply","/api/selfdev/promote","/api/fabrication/job"].includes(p))delegateApproval=true;
  if(["/api/approvals/request","/api/approvals/decide","/api/policy/evaluate","/api/policy/simulate","/api/auth/logout","/api/governance/emergency/engage"].includes(p))risk="low";
  return {public:false,stateChanging,capability,risk,external,mutatesSource,requiresCredential,delegateApproval};
}

export class RequestAuthorizer{
  constructor({identity,policyEngine,approvalStore,audit,appVersion,rateLimitPerMinute=Number(process.env.IUV_RATE_LIMIT_PER_MINUTE||120)}={}){
    Object.assign(this,{identity,policyEngine,approvalStore,audit,appVersion});
    this.limit=Math.max(10,Math.min(10000,Number(rateLimitPerMinute)||120));this.buckets=new Map();
  }
  _rate(identityId,path){
    const now=Date.now(),window=Math.floor(now/60000),key=identityId+"|"+path+"|"+window;
    const n=(this.buckets.get(key)||0)+1;this.buckets.set(key,n);
    if(this.buckets.size>5000)for(const k of this.buckets.keys())if(!k.endsWith("|"+window))this.buckets.delete(k);
    return {allowed:n<=this.limit,count:n,limit:this.limit,resetAt:new Date((window+1)*60000).toISOString()};
  }
  authorize({req,url,body={},requestId,correlationId}={}){
    const meta=routeSecurity(req.method,url.pathname);
    const auth=this.identity.authenticateRequest(req);
    if(meta.public){
      if(meta.stateChanging){const validation=validateRequestBody(req.method,url.pathname,body);if(validation.state!=="SUCCESS")return {state:"BLOCKED",allowed:false,httpStatus:400,message:"Request body failed route schema validation.",meta,auth,validation};}
      return {state:"SUCCESS",allowed:true,meta,auth,policy:null};
    }
    if(!auth.authenticated)return {state:"UNAUTHENTICATED",allowed:false,httpStatus:401,message:"Local owner authentication is required.",meta,auth};
    const rate=this._rate(auth.identityId,url.pathname);
    if(!rate.allowed)return {state:"BLOCKED",allowed:false,httpStatus:429,message:"Local API rate limit exceeded.",meta,auth,rate};
    if(meta.stateChanging&&auth.csrfRequired){
      const csrf=String(req.headers["x-uai-csrf"]||"");
      if(!this.identity.verifyCsrf(auth,csrf))return {state:"BLOCKED",allowed:false,httpStatus:403,message:"CSRF token is required for cookie-authenticated state changes.",meta,auth,rate};
    }
    if(meta.stateChanging){const validation=validateRequestBody(req.method,url.pathname,body);if(validation.state!=="SUCCESS")return {state:"BLOCKED",allowed:false,httpStatus:400,message:"Request body failed route schema validation.",meta,auth,rate,validation};}
    const args=cleanBody(body),operation=`http.${req.method} ${url.pathname}`;
    const policy=this.policyEngine.evaluate({operation,risk:meta.risk,external:meta.external,mutatesSource:meta.mutatesSource,requiresCredential:meta.requiresCredential});
    const binding={operation,arguments:{body:args,query:Object.fromEntries(url.searchParams.entries())},capability:meta.capability,actor:auth.identityId,toolVersion:this.appVersion,actionEnvelopeId:body.actionEnvelopeId||null,taskId:body.taskId||null};
    if(["DENY","BLOCK"].includes(policy.decision))return {state:policy.decision,allowed:false,httpStatus:403,message:policy.reason,meta,auth,policy,binding,rate};
    if(["ASK","ESCALATE"].includes(policy.decision)&&!meta.delegateApproval){
      const approvalId=body.approvalId||req.headers["x-uai-approval-id"]||null;
      if(!approvalId)return {state:policy.decision,allowed:false,httpStatus:409,message:"Exact HTTP invocation approval is required.",meta,auth,policy,binding,rate};
      const approval=this.approvalStore.validate(approvalId,binding);
      if(approval.state!=="SUCCESS")return {state:approval.state,allowed:false,httpStatus:403,message:approval.message,meta,auth,policy,binding,approval,rate};
    }
    const context={state:"SUCCESS",allowed:true,meta,auth,policy,binding,requestId,correlationId,argumentsHash:sha(binding.arguments),rate};
    this.audit?.append({type:"api.authorize",requestId,correlationId,actor:auth.identityId,method:req.method,path:url.pathname,capability:meta.capability,risk:meta.risk,policyDecision:policy.decision,argumentsHash:context.argumentsHash});
    return context;
  }
}
