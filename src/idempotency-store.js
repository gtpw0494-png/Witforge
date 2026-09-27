import crypto from "node:crypto";
import {GovernanceDb} from "./governance-db.js";

const stable=value=>Array.isArray(value)
  ? `[${value.map(stable).join(",")}]`
  : value&&typeof value==="object"
    ? `{${Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+stable(value[k])).join(",")}}`
    : JSON.stringify(value);

export function requestDigest(value){
  return crypto.createHash("sha256").update(stable(value)).digest("hex");
}

export class IdempotencyStore{
  constructor(stateRoot,audit=null){
    this.db=new GovernanceDb(stateRoot);
    this.audit=audit;
  }

  _id(key){
    return `idem-${crypto.createHash("sha256").update(String(key)).digest("hex")}`;
  }

  _strip(x){
    if(!x)return null;
    const y={...x};delete y._version;return y;
  }

  get(key){
    const r=this.db.get("idempotency",this._id(key));
    return r.record?{...r.record,_version:r.version}:null;
  }

  begin(key,{operation="",requestHash="",ttlMs=86400000}={}){
    if(!key)return {state:"BYPASS",message:"No idempotency key supplied."};
    const now=Date.now();
    const id=this._id(key);
    const current=this.get(key);

    if(current){
      const expired=Date.parse(current.expiresAt||0)<=now;
      if(!expired){
        if(current.operation!==String(operation)||current.requestHash!==String(requestHash)){
          return {state:"DENIED",message:"Idempotency key was already used for a different request.",record:this._strip(current)};
        }
        if(current.status==="COMPLETED"){
          return {state:"REPLAY",message:"Returning the previously completed result without re-execution.",result:current.result,record:this._strip(current)};
        }
        return {state:"BLOCKED",message:"An identical request with this idempotency key is already in progress.",record:this._strip(current)};
      }

      const body={
        id,keyHash:id.slice(5),operation:String(operation),requestHash:String(requestHash),
        status:"IN_PROGRESS",createdAt:new Date(now).toISOString(),
        expiresAt:new Date(now+Math.max(60000,Number(ttlMs)||86400000)).toISOString(),
        result:null
      };
      const r=this.db.cas("idempotency",id,current._version,body,{type:"restart-expired",operation});
      if(r.state!=="SUCCESS")return r;
      this.audit?.append({type:"idempotency.begin",idempotencyId:id,operation,reusedExpired:true});
      return {state:"SUCCESS",record:body};
    }

    const body={
      id,keyHash:id.slice(5),operation:String(operation),requestHash:String(requestHash),
      status:"IN_PROGRESS",createdAt:new Date(now).toISOString(),
      expiresAt:new Date(now+Math.max(60000,Number(ttlMs)||86400000)).toISOString(),
      result:null
    };
    const r=this.db.create("idempotency",body);
    if(r.state!=="SUCCESS"){
      const race=this.get(key);
      if(race&&race.operation===String(operation)&&race.requestHash===String(requestHash)){
        return race.status==="COMPLETED"
          ?{state:"REPLAY",message:"Returning the previously completed result without re-execution.",result:race.result,record:this._strip(race)}
          :{state:"BLOCKED",message:"An identical request with this idempotency key is already in progress.",record:this._strip(race)};
      }
      return r;
    }
    this.audit?.append({type:"idempotency.begin",idempotencyId:id,operation});
    return {state:"SUCCESS",record:body};
  }

  complete(key,result){
    if(!key)return {state:"BYPASS"};
    const current=this.get(key);
    if(!current)return {state:"FAILURE",message:"Idempotency record not found."};
    const body={...this._strip(current),status:"COMPLETED",completedAt:new Date().toISOString(),result};
    const r=this.db.cas("idempotency",current.id,current._version,body,{type:"complete",resultState:result?.state||null});
    if(r.state==="SUCCESS")this.audit?.append({type:"idempotency.complete",idempotencyId:current.id,resultState:result?.state||null});
    return r;
  }

  fail(key,result){
    if(!key)return {state:"BYPASS"};
    const current=this.get(key);
    if(!current)return {state:"FAILURE",message:"Idempotency record not found."};
    const body={...this._strip(current),status:"FAILED",completedAt:new Date().toISOString(),result};
    const r=this.db.cas("idempotency",current.id,current._version,body,{type:"fail",resultState:result?.state||null});
    if(r.state==="SUCCESS")this.audit?.append({type:"idempotency.fail",idempotencyId:current.id,resultState:result?.state||null});
    return r;
  }
}
