import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";
import {PlatformStateStore} from "../platform-state-store.js";
const repoRoot=path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const iso=()=>new Date().toISOString();
const inside=(root,p)=>p===root||p.startsWith(root+path.sep);
function sha256File(file){const h=crypto.createHash("sha256"),fd=fs.openSync(file,"r"),buf=Buffer.allocUnsafe(1024*1024);try{let n=0;while((n=fs.readSync(fd,buf,0,buf.length,null))>0)h.update(buf.subarray(0,n));}finally{fs.closeSync(fd);}return h.digest("hex");}
export class ModelArtifactVerifier{
  constructor({stateRoot,audit=null,allowedRoots=null}={}){this.db=new PlatformStateStore(stateRoot);this.audit=audit;this.allowedRoots=(allowedRoots||[path.join(repoRoot,"model"),path.join(stateRoot||path.join(repoRoot,"state"),"model-artifacts")]).map(x=>path.resolve(x));}
  _resolve(p){const target=path.resolve(repoRoot,String(p||""));return this.allowedRoots.some(root=>inside(root,target))?target:null;}
  verify(input={}){
    const target=this._resolve(input.path);if(!target)return {state:"DENIED",verified:false,message:"Model artifact path is outside approved model roots."};if(!fs.existsSync(target)||!fs.statSync(target).isFile())return {state:"UNAVAILABLE",verified:false,message:"Model artifact file is unavailable."};
    const actual=sha256File(target),expected=String(input.expectedSha256||"").toLowerCase(),hashVerified=Boolean(expected)&&/^[a-f0-9]{64}$/.test(expected)&&expected===actual;
    let signatureState="NOT_PROVIDED",signatureVerified=null,publicKeyFingerprint=null;
    if(input.signature||input.publicKey){if(!input.signature||!input.publicKey)return {state:"BLOCKED",verified:false,message:"Both signature and publicKey are required for signature verification.",sha256:actual};try{const key=crypto.createPublicKey(input.publicKey);publicKeyFingerprint=crypto.createHash("sha256").update(key.export({type:"spki",format:"der"})).digest("hex");signatureVerified=crypto.verify(null,Buffer.from(actual,"hex"),key,Buffer.from(String(input.signature),"base64"));signatureState=signatureVerified?"VERIFIED":"DENIED";}catch(e){return {state:"DENIED",verified:false,message:"Artifact signature could not be verified.",sha256:actual,error:String(e.message||e)};}}
    const verified=hashVerified&&(signatureVerified!==false),state=verified?"SUCCESS":expected?"DENIED":"PARTIAL";
    return {state,verified,path:path.relative(repoRoot,target),bytes:fs.statSync(target).size,sha256:actual,expectedSha256:expected||null,hashVerified,signatureState,signatureVerified,publicKeyFingerprint,runtimeAvailability:"UNVERIFIED_RUNTIME",message:verified?"Artifact integrity verified. Runtime executability remains separately health-checked.":expected?"Artifact hash did not match the expected digest.":"Artifact hash was computed but no expected digest was supplied."};
  }
  register(input={}){
    const v=this.verify(input);if(!["SUCCESS","PARTIAL"].includes(v.state))return v;const id="model-artifact-"+crypto.randomUUID(),record={id,modelId:String(input.modelId||"unknown").slice(0,256),version:String(input.version||"unknown").slice(0,128),subjectId:String(input.modelId||"unknown").slice(0,256),artifact:v,metadata:input.metadata&&typeof input.metadata==="object"?input.metadata:{},state:v.verified?"INTEGRITY_VERIFIED":"HASH_COMPUTED",runtimeAvailability:"UNVERIFIED_RUNTIME",productionEligible:false,createdAt:iso(),updatedAt:iso()};
    const r=this.db.create("model-artifact",record);if(r.state==="SUCCESS")this.audit?.append({type:"model.artifact.registered",artifactId:id,modelId:record.modelId,state:record.state,sha256:v.sha256});return r.state==="SUCCESS"?{state:"SUCCESS",artifact:record}:r;
  }
  list(limit=100){return this.db.list("model-artifact",limit).records||[];}
  get(id){return this.db.get("model-artifact",id).record||null;}
}
