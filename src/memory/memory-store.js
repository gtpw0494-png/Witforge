import crypto from "node:crypto";
import {PlatformStateStore} from "../platform-state-store.js";
import {validateMemoryConsent} from "./consent.js";
import {memoryExpired,retentionExpiry} from "./retention.js";
const iso=ms=>new Date(ms??Date.now()).toISOString();
const clamp=x=>Math.max(0,Math.min(1,Number.isFinite(Number(x))?Number(x):1));
function keyFromEnv(){
  const raw=String(process.env.IUV_MEMORY_KEY||"").trim();if(!raw)return null;
  if(/^[0-9a-fA-F]{64}$/.test(raw))return Buffer.from(raw,"hex");
  try{const b=Buffer.from(raw,"base64");return b.length===32?b:null;}catch{return null;}
}
function encrypt(key,text){
  if(!key)return {mode:"PLAINTEXT_LOCAL",text:String(text??"")};
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",key,iv),ciphertext=Buffer.concat([cipher.update(String(text??""),"utf8"),cipher.final()]),tag=cipher.getAuthTag();
  return {mode:"AES_256_GCM",ciphertext:ciphertext.toString("base64"),iv:iv.toString("base64"),tag:tag.toString("base64")};
}
function decrypt(key,payload){
  if(payload?.mode!=="AES_256_GCM")return String(payload?.text??"");
  if(!key)return null;
  try{const decipher=crypto.createDecipheriv("aes-256-gcm",key,Buffer.from(payload.iv,"base64"));decipher.setAuthTag(Buffer.from(payload.tag,"base64"));return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext,"base64")),decipher.final()]).toString("utf8");}catch{return null;}
}
export class MemoryStore{
  constructor({stateRoot,audit=null}={}){this.db=new PlatformStateStore(stateRoot);this.audit=audit;this.key=keyFromEnv();}
  status(ownerId=null){const filters=ownerId?{ownerId}:{};const rows=this.db.list("memory-item",10000,filters).records||[];return {state:"SUCCESS",ownerId,items:rows.length,active:rows.filter(x=>x.deletionState==="ACTIVE"&&!memoryExpired(x)).length,deleted:rows.filter(x=>x.deletionState!=="ACTIVE").length,encryption:this.key?"AES_256_GCM":"PLAINTEXT_LOCAL",trainingDefault:false,store:this.db.status()};}
  settings(ownerId){
    const id="memory-settings:"+String(ownerId),r=this.db.get("memory-settings",id);if(r.record)return r.record;
    return {id,ownerId:String(ownerId),state:"ACTIVE",memoryEnabled:true,trainingEnabled:false,createdAt:null,updatedAt:null};
  }
  setSettings(ownerId,{memoryEnabled,trainingEnabled}={}){
    const owner=String(ownerId||"").trim();if(!owner)return {state:"BLOCKED",message:"ownerId required."};const id="memory-settings:"+owner,cur=this.db.get("memory-settings",id),now=iso();
    const base=cur.record||{id,ownerId:owner,state:"ACTIVE",memoryEnabled:true,trainingEnabled:false,createdAt:now};
    const body={...base,memoryEnabled:memoryEnabled===undefined?base.memoryEnabled:Boolean(memoryEnabled),trainingEnabled:trainingEnabled===undefined?base.trainingEnabled:Boolean(trainingEnabled),updatedAt:now};
    const r=cur.record?this.db.cas("memory-settings",id,cur.version,body,{type:"memory.settings.updated"}):this.db.create("memory-settings",body);
    if(r.state==="SUCCESS")this.audit?.append({type:"memory.settings",ownerId:owner,memoryEnabled:body.memoryEnabled,trainingEnabled:body.trainingEnabled});return r.state==="SUCCESS"?{state:"SUCCESS",settings:body}:r;
  }
  remember(input={}){
    const owner=String(input.ownerId||"").trim();if(!owner)return {state:"BLOCKED",message:"ownerId required."};const settings=this.settings(owner);if(settings.memoryEnabled===false)return {state:"BLOCKED",message:"Memory is disabled for this owner."};
    const consent=validateMemoryConsent(input);if(!consent.allowed)return consent;
    const now=Date.now(),id="memory-"+crypto.randomUUID(),trainingAllowed=settings.trainingEnabled===true&&input.trainingAllowed===true;
    const record={id,ownerId:owner,namespace:consent.namespace,sourceId:String(input.sourceId||input.source||"user:explicit").slice(0,1024),subjectId:input.subjectId?String(input.subjectId).slice(0,512):null,
      payload:encrypt(this.key,input.text??input.value??""),consent:consent.consent,confidence:clamp(input.confidence),visibility:String(input.visibility||"owner").slice(0,64),
      reason:String(input.reason||"user-approved memory").slice(0,1000),retentionPolicy:String(input.retentionPolicy||"until-deleted").slice(0,64),expiresAt:retentionExpiry(input.retentionPolicy,input.ttlMs,now),
      deletionState:"ACTIVE",trainingAllowed,memoryAllowed:true,createdAt:iso(now),updatedAt:iso(now)};
    const r=this.db.create("memory-item",record);if(r.state==="SUCCESS")this.audit?.append({type:"memory.remembered",memoryId:id,ownerId:owner,namespace:record.namespace,sourceId:record.sourceId,trainingAllowed});
    return r.state==="SUCCESS"?{state:"SUCCESS",memory:this._public(record)}:r;
  }
  _public(record,{includeDeleted=false}={}){
    if(!record)return null;const text=decrypt(this.key,record.payload),expired=memoryExpired(record),active=record.deletionState==="ACTIVE"&&!expired;
    if(!includeDeleted&&!active)return null;
    return {...record,payload:undefined,text:text===null?null:text,encryptionState:record.payload?.mode||"UNKNOWN",locked:text===null,expired};
  }
  get(id,{includeDeleted=false}={}){return this._public(this.db.get("memory-item",id).record,{includeDeleted});}
  list({ownerId,namespace=null,sourceId=null,limit=100,includeDeleted=false}={}){
    const filters={};if(ownerId)filters.ownerId=ownerId;if(sourceId)filters.sourceId=sourceId;let rows=this.db.list("memory-item",limit,filters).records||[];
    if(namespace)rows=rows.filter(x=>x.namespace===namespace);return rows.map(x=>this._public(x,{includeDeleted})).filter(Boolean);
  }
  search(query,{ownerId,namespace=null,limit=20}={}){
    const q=String(query||"").trim().toLowerCase();if(!q)return {state:"BLOCKED",message:"query required."};const rows=this.list({ownerId,namespace,limit:10000});
    const scored=rows.map(x=>{const hay=[x.text,x.reason,x.sourceId,x.subjectId].filter(Boolean).join(" ").toLowerCase();const terms=q.split(/\s+/).filter(Boolean),score=terms.reduce((n,t)=>n+(hay.includes(t)?1:0),0)/(terms.length||1);return {...x,score};}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0,Math.max(1,Math.min(100,Number(limit)||20)));
    return {state:"SUCCESS",query,results:scored};
  }
  why(id,ownerId=null){const x=this.get(id,{includeDeleted:true});if(!x||ownerId&&x.ownerId!==ownerId)return {state:"FAILURE",message:"Memory item not found."};return {state:"SUCCESS",memoryId:x.id,ownerId:x.ownerId,namespace:x.namespace,sourceId:x.sourceId,reason:x.reason,consent:x.consent,confidence:x.confidence,retentionPolicy:x.retentionPolicy,expiresAt:x.expiresAt,trainingAllowed:x.trainingAllowed,deletionState:x.deletionState,encryptionState:x.encryptionState};}
  forget(id,ownerId=null,reason="user-requested forget"){
    const cur=this.db.get("memory-item",id);if(!cur.record||ownerId&&cur.record.ownerId!==ownerId)return {state:"FAILURE",message:"Memory item not found."};if(cur.record.deletionState!=="ACTIVE")return {state:"SUCCESS",memory:this._public(cur.record,{includeDeleted:true})};
    const body={...cur.record,deletionState:"SOFT_DELETED",deletedAt:iso(),deletionReason:String(reason).slice(0,1000),updatedAt:iso()};const r=this.db.cas("memory-item",id,cur.version,body,{type:"memory.forgotten"});
    if(r.state==="SUCCESS")this.audit?.append({type:"memory.forgotten",memoryId:id,ownerId:body.ownerId,reason});return r.state==="SUCCESS"?{state:"SUCCESS",memory:this._public(body,{includeDeleted:true})}:r;
  }
  forgetSource(sourceId,ownerId=null,reason="user-requested source forget"){
    const rows=this.db.list("memory-item",10000,{sourceId,...(ownerId?{ownerId}:{})}).records||[],forgotten=[];
    for(const x of rows)if(x.deletionState==="ACTIVE"){const r=this.forget(x.id,ownerId,reason);if(r.state==="SUCCESS")forgotten.push(x.id);}
    return {state:"SUCCESS",sourceId,forgotten};
  }
  purge(id,ownerId=null,reason="user-requested purge"){
    const cur=this.db.get("memory-item",id);if(!cur.record||ownerId&&cur.record.ownerId!==ownerId)return {state:"FAILURE",message:"Memory item not found."};
    const r=this.db.delete("memory-item",id,{type:"memory.purged",reason:String(reason).slice(0,1000),ownerId:cur.record.ownerId});if(r.state==="SUCCESS")this.audit?.append({type:"memory.purged",memoryId:id,ownerId:cur.record.ownerId,reason});return r;
  }
  export(ownerId,{includeDeleted=false}={}){return {state:"SUCCESS",ownerId,exportedAt:iso(),trainingDefault:false,items:this.list({ownerId,limit:10000,includeDeleted})};}
  maintenance(now=Date.now()){
    const expired=[];for(const x of this.db.list("memory-item",10000).records||[])if(x.deletionState==="ACTIVE"&&memoryExpired(x,now)){const cur=this.db.get("memory-item",x.id),body={...x,deletionState:"EXPIRED",expiredAt:iso(now),updatedAt:iso(now)};const r=this.db.cas("memory-item",x.id,cur.version,body,{type:"memory.expired"});if(r.state==="SUCCESS")expired.push(x.id);}
    return {state:"SUCCESS",expired};
  }
}
