const numeric=x=>Number.isFinite(Number(x))?Number(x):0;
const normalize=(rows,key="score")=>{const vals=rows.map(x=>numeric(x[key])),max=Math.max(...vals,0),min=Math.min(...vals,0);return rows.map((x,i)=>({...x,_norm:max===min?(max?1:0):(vals[i]-min)/(max-min)}));};
export class HybridRetrievalEngine{
  constructor({documentStore=null,storageDb=null,neuralAdapter=null,audit=null}={}){this.documents=documentStore;this.storage=storageDb;this.neural=neuralAdapter;this.audit=audit;}
  status(){const neural=this.neural?.status?.()||{state:"UNAVAILABLE"};return {state:"SUCCESS",lexical:"CONNECTED",sparseSemantic:this.storage?"CONNECTED":"UNAVAILABLE",documentRetrieval:this.documents?"CONNECTED":"UNAVAILABLE",neuralDense:neural.embeddingAvailability||"UNAVAILABLE",neuralReranker:neural.rerankerAvailability||"UNAVAILABLE",neural};}
  async search(query,{limit=8,pool=30,useDense=true,useReranker=true}={}){
    const q=String(query||"").trim();if(!q)return {state:"BLOCKED",message:"query required."};const gathered=[];
    if(this.documents){const d=await this.documents.search(q,pool);for(const x of d?.matches||d?.results||[])gathered.push({id:"doc:"+(x.chunk_id||x.chunkId||x.id),kind:"document",text:x.text||x.excerpt||"",title:x.title||"",sourceId:x.source_id||x.sourceId||null,documentId:x.document_id||x.documentId||null,chunkId:x.chunk_id||x.chunkId||null,baseScore:numeric(x.score||x.rankScore||1),raw:x});}
    if(this.storage){const s=await this.storage.semanticSearch(q,"all",pool);for(const x of s?.matches||[])gathered.push({id:x.kind+":"+x.recordId,kind:x.kind,text:x.text||"",title:x.title||"",sourceId:x.source_id||null,baseScore:numeric(x.score),raw:x});}
    const byId=new Map();for(const x of gathered){const cur=byId.get(x.id);if(!cur||x.baseScore>cur.baseScore)byId.set(x.id,x);}
    let rows=normalize([...byId.values()],"baseScore").map(x=>({...x,hybridScore:x._norm}));let dense={state:"UNAVAILABLE"},rerank={state:"UNAVAILABLE"};
    const status=this.neural?.status?.()||{};
    if(useDense&&rows.length&&status.embeddingAvailability==="CONFIGURED"){
      dense=this.neural.embed([q,...rows.map(x=>x.text)]);if(dense.state==="SUCCESS"&&dense.vectors?.length===rows.length+1){const qv=dense.vectors[0],cos=(a,b)=>a.reduce((n,v,i)=>n+v*(b[i]||0),0);rows=rows.map((x,i)=>({...x,denseScore:cos(qv,dense.vectors[i+1])}));const n=normalize(rows,"denseScore");rows=n.map(x=>({...x,hybridScore:.55*x._norm+.45*Math.max(0,x.denseScore||0)}));}
    }
    rows.sort((a,b)=>b.hybridScore-a.hybridScore);
    if(useReranker&&rows.length&&status.rerankerAvailability==="CONFIGURED"){
      const top=rows.slice(0,Math.min(pool,rows.length));rerank=this.neural.rerank(q,top.map(x=>x.text));if(rerank.state==="SUCCESS"&&rerank.scores?.length===top.length){const scored=top.map((x,i)=>({...x,rerankScore:numeric(rerank.scores[i])})).sort((a,b)=>b.rerankScore-a.rerankScore);rows=[...scored,...rows.slice(top.length)];}
    }
    const out=rows.slice(0,Math.max(1,Math.min(100,Number(limit)||8))).map(({_norm,raw,...x})=>x),neuralUsed=dense.state==="SUCCESS"||rerank.state==="SUCCESS";
    const result={state:out.length?"SUCCESS":"UNAVAILABLE",query:q,results:out,retrieval:{lexicalSparse:true,neuralDenseUsed:dense.state==="SUCCESS",rerankerUsed:rerank.state==="SUCCESS",denseState:dense.state,rerankerState:rerank.state},message:out.length?"Retrieved and ranked local evidence.":"No local evidence matched."};
    this.audit?.append({type:"retrieval.hybrid",queryHash:(await import("node:crypto")).createHash("sha256").update(q).digest("hex"),results:out.length,neuralUsed});return result;
  }
}
