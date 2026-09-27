import crypto from "node:crypto";
import {GovernanceDb} from "../governance-db.js";
const owner=a=>Boolean(a?.allowed&&a?.auth?.authenticated&&a.auth.role==="owner");
const fp=x=>crypto.createHash("sha256").update(String(x||"")).digest("hex");
export class TrustedDeviceRegistry{
  constructor(stateRoot,audit=null){this.db=new GovernanceDb(stateRoot);this.audit=audit;}
  list(limit=100){return this.db.list("trusted-device",limit).records||[];}
  enroll({name,publicKey,deviceId=null}={},authorization){
    if(!owner(authorization))return {state:"DENIED",message:"Authenticated local-owner authority is required for trusted-device enrollment."};
    if(!String(publicKey||"").trim())return {state:"BLOCKED",message:"A device public key is required."};
    const id=deviceId||"device-"+fp(publicKey).slice(0,24),body={id,name:String(name||id).slice(0,256),publicKeyFingerprint:fp(publicKey),status:"ENROLLED",proofMode:"REGISTERED_KEY_NO_HARDWARE_ATTESTATION",independentOwnershipProof:false,enrolledBy:authorization.auth.identityId,enrolledAt:new Date().toISOString()};
    const r=this.db.create("trusted-device",body);if(r.state==="SUCCESS")this.audit?.append({type:"governance.device.enrolled",deviceId:id,enrolledBy:body.enrolledBy});return r.state==="SUCCESS"?{state:"SUCCESS",device:body}:r;
  }
  revoke(id,authorization){
    if(!owner(authorization))return {state:"DENIED",message:"Authenticated local-owner authority is required for device revocation."};
    const cur=this.db.get("trusted-device",id);if(!cur.record)return {state:"FAILURE",message:"Device not found."};
    const body={...cur.record,status:"REVOKED",revokedAt:new Date().toISOString(),revokedBy:authorization.auth.identityId},r=this.db.cas("trusted-device",id,cur.version,body,{type:"device.revoke"});
    return r.state==="SUCCESS"?{state:"SUCCESS",device:body}:r;
  }
}
