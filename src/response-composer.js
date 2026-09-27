const textOf=x=>String(x??"").trim();
const byAgent=(items,name)=>items.find(x=>x.agent===name)?.result||null;
function isGreeting(s){return /^(hi|hello|hey|g'day|good\s+(morning|afternoon|evening))[!. ]*$/i.test(s.trim());}
export function modelTextQuality(text){
  const t=textOf(text);
  if(!t)return {usable:false,reason:"empty"};
  if(/<\|[^|]+\|>/.test(t))return {usable:false,reason:"control-token-leak"};
  if(t.length<12)return {usable:false,reason:"too-short"};
  const words=t.split(/\s+/).filter(Boolean);
  const alpha=words.filter(w=>/[A-Za-z]{2,}/.test(w));
  const vowelish=alpha.filter(w=>/[aeiouy]/i.test(w));
  const unique=new Set(words.map(w=>w.toLowerCase()));
  if(words.length>=6&&unique.size/words.length<0.45)return {usable:false,reason:"low-diversity"};
  if(alpha.length>=5&&vowelish.length/alpha.length<0.65)return {usable:false,reason:"low-word-likeness"};
  return {usable:true,reason:"heuristic-pass"};
}
export class ResponseComposer{
  constructor({allowRawModel=process.env.FORGELM_ALLOW_RAW_RESPONSES==="1"}={}){this.allowRawModel=allowRawModel;}
  compose({message,contributions=[]}){
    const msg=textOf(message), conv=byAgent(contributions,"conversation"), fm=byAgent(contributions,"forgelm"), exp=byAgent(contributions,"explorative"), kn=byAgent(contributions,"knowledge"), res=byAgent(contributions,"research"), web=byAgent(contributions,"web-research"), docs=byAgent(contributions,"documents"), dev=byAgent(contributions,"development"), learn=byAgent(contributions,"learning"), sys=byAgent(contributions,"systems"), lex=byAgent(contributions,"lexicon"), dlg=byAgent(contributions,"dialogue");
    if(conv?.state==="SUCCESS"&&conv.message)return {message:conv.message,mode:"native-conversation",modelUsed:conv.modelUsed===true,quality:{usable:true,reason:"runtime-pass"}};
    if(isGreeting(msg))return {message:"Hello. OneChat is ready. I can chat naturally and coordinate governed local tools and agents when your request needs them.",mode:"governed-composer",modelUsed:false};
    if(fm){
      if(fm.message&&!fm.text)return {message:fm.message,mode:"agent-result",modelUsed:false};
      if(fm.text){const q=modelTextQuality(fm.text);if(this.allowRawModel&&q.usable)return {message:fm.text,mode:"forgelm-raw",modelUsed:true,quality:q};
        const details=[];if(fm.parameters)details.push(`${fm.parameters.toLocaleString()} parameters`);if(fm.device)details.push(`device ${fm.device}`);if(fm.checkpoint)details.push("checkpoint present");
        return {message:`ForgeLM executed locally, but this seed checkpoint is not yet promoted for primary conversational replies${details.length?` (${details.join(", ")})`:""}. Its raw generation is preserved in the turn evidence for training and evaluation rather than shown as a trusted answer.`,mode:"quality-gated",modelUsed:true,quality:q};}
    }
    if(lex?.definitions?.length){const d=lex.definitions[0];return {message:`${d.term}${d.pos?` (${d.pos})`:""}: ${d.definition}${d.example?` Example: ${d.example}`:""}`,mode:"lexicon-db",modelUsed:false};}
    if(lex?.relations?.length){const items=lex.relations.slice(0,8).map(r=>`${r.relation}: ${r.target_term}`).join("; ");return {message:`Lexical relationships for ${lex.term}: ${items}.`,mode:"lexicon-relations",modelUsed:false};}
    if(kn?.matches?.length){const items=kn.matches.slice(0,5).map(x=>`${x.kind}:${x.title||x.term||x.recordId} (${Number(x.score||0).toFixed(3)})`).join("; ");return {message:`Semantic retrieval found ${kn.matches.length} ranked local match${kn.matches.length===1?"":"es"}: ${items}.`,mode:"semantic-retrieval",modelUsed:false};}
    if(docs?.matches?.length){
      const refs=docs.matches.slice(0,5).map((x,i)=>"["+(i+1)+"] "+(x.title||x.canonical_uri||x.document_id)+" — "+x.chunk_id+" (rev "+x.revision+")").join("; ");
      return {message:"Evidence retrieval found "+docs.matches.length+" eligible source chunk"+(docs.matches.length===1?"":"s")+": "+refs+".",mode:"evidence-retrieval",modelUsed:false,evidence:{status:"SUPPORTED",sources:docs.matches.slice(0,5).map(x=>({sourceId:x.source_id,documentId:x.document_id,chunkId:x.chunk_id,revision:x.revision,uri:x.canonical_uri,quote:String(x.text||"").slice(0,500),score:x.bm25,provenance:x.provenance}))}};
    }
    if(dlg?.messages?.length){const sample=dlg.messages.slice(0,3).map(x=>x.text).join(" / ");return {message:`I found ${dlg.messages.length} local conversation record${dlg.messages.length===1?"":"s"}. Sample: ${sample}`,mode:"dialogue-db",modelUsed:false};}
    if(exp&&(exp.taskId||exp.task||exp.tasks||exp.plan)&&exp.message)return {message:exp.message,mode:"task-lifecycle",modelUsed:false};
    const primary=[dev,learn,sys,web,docs,res,kn].find(x=>x?.message);if(primary)return {message:primary.message,mode:"agent-result",modelUsed:false};
    if(exp){
      if(exp.message)return {message:exp.message,mode:"agent-result",modelUsed:false};
      const evidence=Array.isArray(exp.evidence)?exp.evidence:[];
      if(evidence.length)return {message:`I found ${evidence.length} relevant local knowledge item${evidence.length===1?"":"s"}. Open the agent evidence below to inspect the verified matches.`,mode:"retrieval-composer",modelUsed:false};
      return {message:"I received your message, but the current local knowledge base does not contain enough verified information to answer it reliably yet. The chat itself is working; you can ask me to research/store material, inspect ForgeLM, prepare training data, or develop the codebase, and those agents will collaborate here.",mode:"governed-composer",modelUsed:false};
    }
    return {message:"Your message was received and the collaboration turn completed, but no agent produced a verified answer.",mode:"governed-composer",modelUsed:false};
  }
}
