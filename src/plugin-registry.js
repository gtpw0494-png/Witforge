import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const RISK=new Set(["low","medium","high","critical"]);
const NAME=/^[a-zA-Z0-9._:-]{1,128}$/;
const HOST=/^(\*\.)?[a-z0-9.-]+$/i;
const canon=v=>Array.isArray(v)?`[${v.map(canon).join(",")}]`:v&&typeof v==="object"?`{${Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canon(v[k])).join(",")}}`:JSON.stringify(v);

export function pluginManifestDigest(manifest){
  const clean={...manifest};delete clean.signature;
  return crypto.createHash("sha256").update(canon(clean)).digest("hex");
}

function validateResourceLimits(x={},errors=[],prefix="resourceLimits"){
  if(x.cpuMs!==undefined&&(!Number.isInteger(Number(x.cpuMs))||Number(x.cpuMs)<0||Number(x.cpuMs)>300000))errors.push(`${prefix}.cpuMs out of range`);
  if(x.memoryMb!==undefined&&(!Number.isInteger(Number(x.memoryMb))||Number(x.memoryMb)<0||Number(x.memoryMb)>65536))errors.push(`${prefix}.memoryMb out of range`);
  if(x.maxOutputBytes!==undefined&&(!Number.isInteger(Number(x.maxOutputBytes))||Number(x.maxOutputBytes)<1024||Number(x.maxOutputBytes)>10000000))errors.push(`${prefix}.maxOutputBytes out of range`);
}

function validateOperation(op,index,allowedSecrets){
  const errors=[],p=`operations[${index}]`;
  if(!NAME.test(String(op?.name||"")))errors.push(`${p}.name invalid`);
  if(op?.risk!==undefined&&!RISK.has(String(op.risk)))errors.push(`${p}.risk invalid`);
  if(op?.timeoutMs!==undefined&&(!Number.isInteger(Number(op.timeoutMs))||Number(op.timeoutMs)<100||Number(op.timeoutMs)>300000))errors.push(`${p}.timeoutMs out of range`);
  if(op?.external!==undefined&&typeof op.external!=="boolean")errors.push(`${p}.external must be boolean`);
  if(op?.reversible!==undefined&&typeof op.reversible!=="boolean")errors.push(`${p}.reversible must be boolean`);
  if(op?.idempotencyRequired!==undefined&&typeof op.idempotencyRequired!=="boolean")errors.push(`${p}.idempotencyRequired must be boolean`);
  if(op?.idempotencyTtlMs!==undefined&&(!Number.isInteger(Number(op.idempotencyTtlMs))||Number(op.idempotencyTtlMs)<60000||Number(op.idempotencyTtlMs)>604800000))errors.push(`${p}.idempotencyTtlMs out of range`);
  for(const key of ["secrets","requiresCapabilities"])if(op?.[key]!==undefined&&!Array.isArray(op[key]))errors.push(`${p}.${key} must be an array`);
  for(const s of op?.secrets||[])if(!allowedSecrets.has(String(s)))errors.push(`${p}.secrets contains undeclared secret ${s}`);
  for(const key of ["inputSchema","outputSchema"])if(op?.[key]!==undefined&&op[key]!==null&&(typeof op[key]!=="object"||Array.isArray(op[key])))errors.push(`${p}.${key} must be an inline JSON Schema object`);
  validateResourceLimits(op?.resourceLimits||{},errors,`${p}.resourceLimits`);
  return errors;
}

export function validatePluginManifest(m={}){
  const errors=[];
  if(!/^[a-z0-9][a-z0-9._-]{1,127}$/.test(String(m.id||"")))errors.push("invalid id");
  if(!m.name)errors.push("name required");
  if(!m.version)errors.push("version required");
  if(!m.entrypoint)errors.push("entrypoint required");
  if(!Array.isArray(m.capabilities))errors.push("capabilities must be an array");
  if(m.requiresCapabilities!==undefined&&!Array.isArray(m.requiresCapabilities))errors.push("requiresCapabilities must be an array");
  if(!RISK.has(String(m.risk)))errors.push("invalid risk");
  if(m.apiVersion!==undefined&&!["1","2"].includes(String(m.apiVersion)))errors.push("apiVersion must be 1 or 2");

  const p=m.permissions||{};
  if(!Array.isArray(p.filesystem?.read)||!Array.isArray(p.filesystem?.write))errors.push("filesystem read/write arrays required");
  if(!Array.isArray(p.network?.allow))errors.push("network allow array required");
  if(p.secrets!==undefined&&!Array.isArray(p.secrets))errors.push("permissions.secrets must be an array");
  if(typeof p.process?.spawn!=="boolean")errors.push("process.spawn boolean required");
  for(const host of p.network?.allow||[])if(!HOST.test(String(host)))errors.push(`invalid network host rule: ${host}`);
  for(const scope of [...(p.filesystem?.read||[]),...(p.filesystem?.write||[])])if(String(scope).includes("..")||/[\r\n\0]/.test(String(scope)))errors.push(`invalid filesystem scope: ${scope}`);
  for(const secret of p.secrets||[])if(!NAME.test(String(secret)))errors.push(`invalid secret name: ${secret}`);

  const t=Number(m.timeoutMs);
  if(!Number.isInteger(t)||t<100||t>300000)errors.push("timeoutMs out of range");
  if(!/^[a-f0-9]{64}$/i.test(String(m.provenance?.sha256||"")))errors.push("provenance.sha256 required");
  validateResourceLimits(m.resourceLimits||{},errors);

  if(m.operations!==undefined){
    if(!Array.isArray(m.operations)||!m.operations.length)errors.push("operations must be a non-empty array when supplied");
    else{
      const names=new Set(),allowedSecrets=new Set((p.secrets||[]).map(String));
      m.operations.forEach((op,i)=>{
        errors.push(...validateOperation(op,i,allowedSecrets));
        if(op?.name){if(names.has(op.name))errors.push(`duplicate operation name: ${op.name}`);names.add(op.name);}
      });
    }
  }
  return {state:errors.length?"BLOCKED":"SUCCESS",errors};
}

export function verifyPluginSignature(m={}){
  if(!m.signature)return {state:"UNAVAILABLE",verified:false,reason:"No signature supplied."};
  if(m.signature.algorithm!=="ed25519")return {state:"BLOCKED",verified:false,reason:"Only ed25519 signatures are supported."};
  try{
    const ok=crypto.verify(null,Buffer.from(pluginManifestDigest(m),"utf8"),m.signature.publicKeyPem,Buffer.from(m.signature.signatureBase64,"base64"));
    return {state:ok?"SUCCESS":"DENIED",verified:ok,reason:ok?"Manifest signature verified.":"Manifest signature verification failed."};
  }catch(e){return {state:"ERROR",verified:false,reason:e.message};}
}

export class PluginRegistry{
  constructor(stateRoot,audit=null){
    this.file=path.join(stateRoot,"plugins-v1.json");this.audit=audit;fs.mkdirSync(stateRoot,{recursive:true});
    if(!fs.existsSync(this.file))fs.writeFileSync(this.file,"[]\n");
  }
  list(){try{return JSON.parse(fs.readFileSync(this.file,"utf8"));}catch{return [];}}
  get(id){return this.list().find(x=>x.id===id)||null;}
  operation(id,name="execute"){
    const p=this.get(id);if(!p)return null;
    if(Array.isArray(p.operations)&&p.operations.length)return p.operations.find(x=>x.name===name)||null;
    return name==="execute"?{name:"execute",risk:p.risk,external:(p.permissions?.network?.allow||[]).length>0,reversible:p.reversible===true,timeoutMs:p.timeoutMs,inputSchema:{type:"object"},outputSchema:null,secrets:[],requiresCapabilities:p.requiresCapabilities||[],resourceLimits:p.resourceLimits||{}}:null;
  }
  register(manifest,{builtin=false}={}){
    const v=validatePluginManifest(manifest);
    if(v.state!=="SUCCESS")return {state:"BLOCKED",message:"Plugin manifest validation failed.",errors:v.errors};
    const sig=verifyPluginSignature(manifest),integrity=pluginManifestDigest(manifest);
    const rec={apiVersion:String(manifest.apiVersion||"1"),...manifest,manifestDigest:integrity,signatureState:builtin?"BUILTIN_TRUSTED":sig.verified?"SIGNED_VERIFIED":"REVIEW_REQUIRED",availability:"REGISTERED_NOT_EXECUTABLE",executionBoundary:"EXTERNAL_SANDBOX_REQUIRED",registeredAt:new Date().toISOString()};
    const all=this.list().filter(x=>x.id!==rec.id);all.push(rec);fs.writeFileSync(this.file,JSON.stringify(all,null,2)+"\n");
    this.audit?.append({type:"plugin.register.v2",pluginId:rec.id,manifestDigest:integrity,signatureState:rec.signatureState,operations:(rec.operations||[]).map(x=>x.name)});
    return {state:"SUCCESS",message:"Plugin manifest registered. Execution remains disabled until a sandbox runtime is explicitly configured and verified.",plugin:rec,signature:sig};
  }
  executionStatus(id){
    const p=this.get(id);if(!p)return {state:"FAILURE",message:"Plugin not found."};
    const sandbox=String(process.env.IUV_PLUGIN_SANDBOX_COMMAND||"").trim();
    if(!sandbox)return {state:"UNAVAILABLE",message:"Third-party plugin execution requires IUV_PLUGIN_SANDBOX_COMMAND; registration alone is not execution.",plugin:p};
    if(!["SIGNED_VERIFIED","BUILTIN_TRUSTED"].includes(p.signatureState))return {state:"DENIED",message:"Plugin is not signature-verified/trusted.",plugin:p};
    return {state:"CONFIGURED",message:"Sandbox command is configured. Per-invocation gateway policy, schema, capability and authorization checks still apply.",plugin:p,sandbox};
  }
}
