import fs from "node:fs";import path from "node:path";import crypto from "node:crypto";
const good=new Set(["SUCCESS"]);
export class LearningFabric{
  constructor({store,audit,root}){this.store=store;this.audit=audit;this.root=root;this.file=path.join(root,"model","data","verified-traces.jsonl");fs.mkdirSync(path.dirname(this.file),{recursive:true});}
  eligible(record){
    if(!record)return {ok:false,reason:"missing"};
    if(record.verified===false)return {ok:false,reason:"explicitly-unverified"};
    if(record.state && !good.has(record.state))return {ok:false,reason:`state:${record.state}`};
    if(record.kind==="provider-result" && !record.provider)return {ok:false,reason:"provider provenance missing"};
    return {ok:["chat-turn","task-run","knowledge-analysis","provider-result","development-proposal","reference-definition"].includes(record.kind),reason:"unsupported-kind"};
  }
  transform(r){
    const provenance={knowledgeId:r.id,kind:r.kind,source:r.source||"local",createdAt:r.createdAt||null};
    if(r.kind==="chat-turn")return {id:crypto.randomUUID(),format:"forgelm-trace-v1",instruction:r.user||"",response:r.answer||"",actions:r.allocations||[],truthState:r.state||"SUCCESS",provenance};
    if(r.kind==="task-run")return {id:crypto.randomUUID(),format:"forgelm-trace-v1",instruction:r.request||"",response:JSON.stringify(r.outputs||[]),actions:r.plan?.steps||[],truthState:r.state||"SUCCESS",provenance};
    if(r.kind==="knowledge-analysis")return {id:crypto.randomUUID(),format:"forgelm-trace-v1",instruction:`Study sourced material: ${r.title||"knowledge"}`,response:r.text||"",actions:[{op:"knowledge.ingest"}],truthState:"SUCCESS",provenance};
    if(r.kind==="provider-result")return {id:crypto.randomUUID(),format:"forgelm-trace-v1",instruction:`Learn from verified external result from ${r.provider}`,response:r.text||"",actions:[{op:"external.reference",provider:r.provider,model:r.model||null}],truthState:"SUCCESS",provenance};
    if(r.kind==="development-proposal")return {id:crypto.randomUUID(),format:"forgelm-trace-v1",instruction:r.request||"",response:`Proposal ${r.status||"PROPOSED"} for ${r.targetPath||"unspecified target"}`,actions:[{op:"source.propose",target:r.targetPath||null}],truthState:"SUCCESS",provenance};
    return {id:crypto.randomUUID(),format:"forgelm-trace-v1",instruction:`Define ${r.term||r.title||"term"}`,response:r.definition||r.text||"",actions:[],truthState:"SUCCESS",provenance};
  }
  build({append=false}={}){
    const accepted=[],rejected=[];
    for(const meta of this.store.list()){
      const r=this.store.get(meta.id),e=this.eligible(r);
      if(e.ok)accepted.push(this.transform(r)); else rejected.push({id:meta.id,reason:e.reason});
    }
    const body=accepted.map(x=>JSON.stringify(x)).join("\n")+(accepted.length?"\n":"");
    if(append)fs.appendFileSync(this.file,body);else fs.writeFileSync(this.file,body);
    const digest=crypto.createHash("sha256").update(body).digest("hex");
    const ev=this.audit?.append({type:"learning.export",accepted:accepted.length,rejected:rejected.length,digest,file:this.file});
    return {state:"SUCCESS",message:`Exported ${accepted.length} verified training traces; rejected ${rejected.length}.`,accepted:accepted.length,rejected,digest,file:this.file,auditId:ev?.id||null};
  }
}
