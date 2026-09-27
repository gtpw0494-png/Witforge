import crypto from "node:crypto";
import {PlatformStateStore} from "../platform-state-store.js";
const iso=()=>new Date().toISOString();
const numeric=o=>Object.fromEntries(Object.entries(o||{}).filter(([,v])=>Number.isFinite(Number(v))).map(([k,v])=>[k,Number(v)]));
export class EvaluationStore{
  constructor({stateRoot,audit=null}={}){this.db=new PlatformStateStore(stateRoot);this.audit=audit;}
  record(input={}){
    const subjectId=String(input.subjectId||"").trim(),category=String(input.category||"").trim(),benchmark=String(input.benchmark||"").trim();if(!subjectId||!category||!benchmark)return {state:"BLOCKED",message:"subjectId, category and benchmark are required."};
    const metrics=numeric(input.metrics),evidence=Array.isArray(input.evidence)?input.evidence:[],verified=input.verified===true&&evidence.length>0,id="eval-"+crypto.randomUUID();
    const record={id,subjectId,subjectType:String(input.subjectType||"model"),category,benchmark,metrics,evidence,hardware:input.hardware||null,environment:input.environment||null,state:verified?"VERIFIED":"RECORDED_UNVERIFIED",createdAt:iso(),updatedAt:iso()};
    const r=this.db.create("evaluation-run",record);if(r.state==="SUCCESS")this.audit?.append({type:"evaluation.recorded",evaluationId:id,subjectId,category,benchmark,state:record.state});return r.state==="SUCCESS"?{state:"SUCCESS",evaluation:record}:r;
  }
  list({limit=100,subjectId=null,state=null}={}){return this.db.list("evaluation-run",limit,{...(subjectId?{subjectId}:{}),...(state?{state}:{})}).records||[];}
  leaderboard({category,metric,limit=20,includeUnverified=false}={}){
    const rows=this.list({limit:10000}).filter(x=>(!category||x.category===category)&&(includeUnverified||x.state==="VERIFIED")&&Number.isFinite(Number(x.metrics?.[metric])));
    const best=new Map();for(const x of rows){const cur=best.get(x.subjectId);if(!cur||Number(x.metrics[metric])>Number(cur.metrics[metric]))best.set(x.subjectId,x);}
    return {state:"SUCCESS",category:category||null,metric,verifiedOnly:!includeUnverified,entries:[...best.values()].sort((a,b)=>Number(b.metrics[metric])-Number(a.metrics[metric])||a.subjectId.localeCompare(b.subjectId)).slice(0,Math.max(1,Math.min(100,Number(limit)||20))).map((x,i)=>({rank:i+1,subjectId:x.subjectId,subjectType:x.subjectType,benchmark:x.benchmark,value:Number(x.metrics[metric]),evaluationId:x.id,state:x.state}))};
  }
  status(){const rows=this.list({limit:10000});return {state:"SUCCESS",runs:rows.length,verified:rows.filter(x=>x.state==="VERIFIED").length,categories:[...new Set(rows.map(x=>x.category))].sort()};}
}
