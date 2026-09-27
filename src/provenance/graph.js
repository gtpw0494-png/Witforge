import crypto from "node:crypto";
import {PlatformStateStore} from "../platform-state-store.js";
const iso=()=>new Date().toISOString();
const canonical=v=>Array.isArray(v)?"["+v.map(canonical).join(",")+"]":v&&typeof v==="object"?"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}":JSON.stringify(v);
const sha=v=>crypto.createHash("sha256").update(typeof v==="string"?v:canonical(v)).digest("hex");
export class ProvenanceGraph{
  constructor({stateRoot,audit=null,memoryStore=null}={}){this.db=new PlatformStateStore(stateRoot);this.audit=audit;this.memoryStore=memoryStore;}
  status(){const s=this.db.status();return {state:"SUCCESS",nodes:s.counts?.["provenance-node"]||0,edges:s.counts?.["provenance-edge"]||0,store:s};}
  addNode({type,subjectId=null,sourceId=null,ownerId=null,uri=null,hash=null,metadata={}}={}){
    const nodeType=String(type||"").trim();if(!nodeType)return {state:"BLOCKED",message:"type required."};const id="prov-node-"+crypto.randomUUID(),record={id,type:nodeType,subjectId:subjectId?String(subjectId):null,sourceId:sourceId?String(sourceId):null,ownerId:ownerId?String(ownerId):null,uri:uri?String(uri):null,contentHash:hash?String(hash):null,metadata:metadata&&typeof metadata==="object"?metadata:{},state:"ACTIVE",createdAt:iso(),updatedAt:iso()};
    record.integrity={algorithm:"sha256",digest:sha(record)};const r=this.db.create("provenance-node",record);if(r.state==="SUCCESS")this.audit?.append({type:"provenance.node.created",nodeId:id,nodeType,subjectId:record.subjectId});return r.state==="SUCCESS"?{state:"SUCCESS",node:record}:r;
  }
  addEdge({fromId,toId,relation,metadata={}}={}){
    if(!fromId||!toId||!relation)return {state:"BLOCKED",message:"fromId, toId and relation are required."};if(!this.getNode(fromId)||!this.getNode(toId))return {state:"BLOCKED",message:"Both provenance nodes must exist before an edge is created."};
    const id="prov-edge-"+crypto.randomUUID(),record={id,fromId:String(fromId),toId:String(toId),relation:String(relation).slice(0,128),metadata:metadata&&typeof metadata==="object"?metadata:{},state:"ACTIVE",createdAt:iso(),updatedAt:iso()};
    record.integrity={algorithm:"sha256",digest:sha(record)};const r=this.db.create("provenance-edge",record);if(r.state==="SUCCESS")this.audit?.append({type:"provenance.edge.created",edgeId:id,fromId,toId,relation:record.relation});return r.state==="SUCCESS"?{state:"SUCCESS",edge:record}:r;
  }
  getNode(id){return this.db.get("provenance-node",id).record||null;}
  listNodes({limit=100,type=null,ownerId=null,state=null}={}){let rows=this.db.list("provenance-node",limit,{...(ownerId?{ownerId}:{}),...(state?{state}:{})}).records||[];if(type)rows=rows.filter(x=>x.type===type);return rows;}
  listEdges({limit=100,state=null}={}){return this.db.list("provenance-edge",limit,state?{state}:{}).records||[];}
  trace(id,{direction="both",depth=4,limit=500}={}){
    const start=this.getNode(id);if(!start)return {state:"FAILURE",message:"Provenance node not found."};const edges=this.listEdges({limit:10000,state:"ACTIVE"}),seen=new Set([id]),nodes=[start],used=[],frontier=[{id,depth:0}];
    while(frontier.length&&nodes.length<Math.min(5000,limit)){const cur=frontier.shift();if(cur.depth>=Math.max(1,Math.min(32,Number(depth)||4)))continue;for(const e of edges){let next=null;if((direction==="out"||direction==="both")&&e.fromId===cur.id)next=e.toId;if((direction==="in"||direction==="both")&&e.toId===cur.id)next=e.fromId;if(!next)continue;used.push(e);if(seen.has(next))continue;const n=this.getNode(next);if(n){seen.add(next);nodes.push(n);frontier.push({id:next,depth:cur.depth+1});}}}
    return {state:"SUCCESS",start:id,direction,nodes,edges:[...new Map(used.map(x=>[x.id,x])).values()]};
  }
  descendants(id,limit=5000){const t=this.trace(id,{direction:"out",depth:32,limit});return t.state==="SUCCESS"?t.nodes.filter(x=>x.id!==id):[];}
  planPurge(id){
    const source=this.getNode(id);if(!source)return {state:"FAILURE",message:"Provenance node not found."};const descendants=this.descendants(id),memory=descendants.filter(x=>x.type==="memory"&&x.subjectId),external=descendants.filter(x=>x.type!=="memory");
    return {state:"SUCCESS",mode:"DRY_RUN",source,descendants:descendants.map(x=>({id:x.id,type:x.type,subjectId:x.subjectId,state:x.state})),memoryPurges:memory.map(x=>x.subjectId),externalDeletionRequired:external.map(x=>({id:x.id,type:x.type,subjectId:x.subjectId}))};
  }
  purge(id,{apply=false,ownerId=null,reason="source purge"}={}){
    const plan=this.planPurge(id);if(plan.state!=="SUCCESS"||!apply)return plan;const affected=[];
    for(const n of [plan.source,...this.descendants(id)]){const cur=this.db.get("provenance-node",n.id);if(!cur.record||cur.record.state==="PURGED")continue;const body={...cur.record,state:"PURGED",purgedAt:iso(),purgeReason:String(reason).slice(0,1000),updatedAt:iso()};const r=this.db.cas("provenance-node",n.id,cur.version,body,{type:"provenance.purged",reason});if(r.state==="SUCCESS")affected.push(n.id);if(n.type==="memory"&&n.subjectId&&this.memoryStore)this.memoryStore.purge(n.subjectId,ownerId,reason);}
    this.audit?.append({type:"provenance.purge.applied",sourceNodeId:id,affected:affected.length,externalDeletionRequired:plan.externalDeletionRequired.length});return {...plan,state:"SUCCESS",mode:"APPLIED",affected};
  }
}
