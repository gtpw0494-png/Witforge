import {ResponseComposer} from "./response-composer.js";
import crypto from "node:crypto";
import {EvidenceEnvelope} from "./evidence-envelope.js";
const stateRank=new Map([["SUCCESS",6],["PARTIAL",5],["UNKNOWN",4],["UNAVAILABLE",3],["BLOCKED",2],["DENIED",2],["FAILURE",1],["ERROR",0]]);
const ok=s=>s==="SUCCESS";
function result(state,message,data={}){return {state,message,...data};}
function parseDevelop(message){const m=String(message).match(/^develop\s+file\s+([^\n]+)\n([\s\S]+)$/i);return m?{path:m[1].trim(),content:m[2]}:null;}
function ids(message,re){const m=String(message).match(re);return m?m.slice(1):null;}
export class OneChatRouter{
 constructor(services){Object.assign(this,{sourceRegistry:[]},services);this.responseComposer=services.responseComposer||new ResponseComposer();this.lastEvidence=new Map();}
 _intent(message,chatId){
  this.conversation?.ensureHistory?.(chatId);
  const text=String(message||"").trim(),history=this.conversation?._history?.(chatId)||[];
  const capabilityQuestion=/^(?:can|could|do) you (?:search|browse|access|use) (?:the )?(?:web|internet)\??$/i.test(text);
  const research=!capabilityQuestion&&/(?:latest|current|today|recent|web|internet|research|sources?|citations?|look up|search for|verify online|news|compare.*sources)/i.test(text);
  const followup=history.length>0&&/^(?:and|also|but|so|then|what about|how about|why|how|when|where|who|which|can you|could you|would you|continue|go on|tell me more|explain that|expand|more)\b/i.test(text);
  return {research,followup,capabilityQuestion,historyTurns:history.length};
 }
 async _prepareAttachments(input={}){
  const rows=Array.isArray(input.attachments)?input.attachments:[];
  if(!rows.length)return {state:"SUCCESS",media:{},document:"",evidence:[],artifacts:[]};
  if(!this.multimodalPipeline)return {state:"UNAVAILABLE",media:{},document:"",evidence:[],artifacts:[],message:"Multimodal artifact pipeline is not configured."};
  const media={},docs=[],evidence=[],artifacts=[];
  for(const item of rows.slice(0,16)){
    const mediaId=String(item?.mediaId||"").trim(),file=String(item?.path||"").trim();
    let a=null;
    if(mediaId){
      const d=this.multimodalPipeline.contentDescriptor?.(mediaId,{ownerId:input.ownerId||null});
      if(!d||d.state!=="SUCCESS")return {...(d||{state:"UNAVAILABLE",message:"Media artifact is unavailable."}),media,document:docs.join("\n\n"),evidence,artifacts};
      a=this.multimodalPipeline.get(mediaId);
    }else if(file){
      const reg=this.multimodalPipeline.register({path:file,sourceId:item?.sourceId||null,ownerId:input.ownerId||null,metadata:{chatId:input.chatId||null,label:item?.label||null}});
      if(reg.state!=="SUCCESS")return {...reg,media,document:docs.join("\n\n"),evidence,artifacts};
      a=reg.artifact;
    }else return {state:"BLOCKED",message:"Each attachment requires mediaId or path.",media,document:docs.join("\n\n"),evidence,artifacts};
    artifacts.push({id:a.id,modality:a.modality,path:a.path,label:String(item?.label||a.metadata?.originalName||"").trim()||null,sourceId:a.sourceId||null,mediaType:a.mediaType||null,contentHash:a.contentHash,bytes:a.bytes});
    evidence.push({source_id:a.sourceId||a.id,uri:"media:"+a.id,provenance:{mediaId:a.id,modality:a.modality,contentHash:a.contentHash}});
    if(["image","audio","video"].includes(a.modality)){
      if(!media[a.modality])media[a.modality]=a.path;
      continue;
    }
    const ex=this.multimodalPipeline.extract(a.id);
    if(ex.state==="SUCCESS"){
      for(const d of ex.artifact?.derived||[]){
        if(d.text)docs.push(`[${a.modality}:${a.id}${d.locator?.page?":page "+d.locator.page:""}]\n${d.text}`);
      }
    }else if(ex.state!=="UNAVAILABLE")return {...ex,media,document:docs.join("\n\n"),evidence,artifacts};
  }
  return {state:"SUCCESS",media,document:docs.join("\n\n"),evidence,artifacts};
 }
 history(chatId,{limit=50,ownerId=null}={}){
  const id=String(chatId||"").trim();if(!id)return {state:"BLOCKED",message:"chatId is required.",turns:[]};
  const rows=this.store?.list?.()||[],turns=[];
  for(let i=Math.max(0,rows.length-1000);i<rows.length;i++){
    let x=null;try{x=this.store.get(rows[i].id);}catch{}
    if(!x||x.kind!=="chat-turn"||x.chatId!==id)continue;
    if(x.ownerId&&ownerId&&x.ownerId!==ownerId)continue;
    const attachments=(x.attachments||[]).map(a=>({
      id:a.id||null,
      modality:a.modality||"structured",
      label:a.label||null,
      sourceId:a.sourceId||null,
      mediaType:a.mediaType||null,
      contentHash:a.contentHash||null,
      bytes:Number(a.bytes||0)
    })).filter(a=>a.id);
    turns.push({
      id:x.id,
      createdAt:x.createdAt||x.at||null,
      user:String(x.user||""),
      answer:String(x.answer||""),
      state:x.state||"UNKNOWN",
      responseMode:x.responseMode||null,
      attachments,
      evidenceId:x.evidenceEnvelope?.id||null,
      evidenceSummary:{claims:Number(x.evidenceEnvelope?.claims?.length||0),supported:Number((x.evidenceEnvelope?.claims||[]).filter(c=>c.status==="SUPPORTED").length),tools:Number(x.evidenceEnvelope?.toolCalls?.length||0),model:x.evidenceEnvelope?.model?.id||x.evidenceEnvelope?.model?.provider||null}
    });
  }
  const n=Math.max(1,Math.min(200,Number(limit)||50));
  return {state:"SUCCESS",chatId:id,turns:turns.slice(-n),count:Math.min(turns.length,n)};
 }
 _conversationControls(){
  const controls=new Map(),rows=this.store?.list?.()||[];
  for(let i=0;i<rows.length;i++){
    let x=null;try{x=this.store.get(rows[i].id);}catch{}
    if(!x||x.kind!=="conversation-control"||!x.chatId)continue;
    controls.set(x.chatId,{...(controls.get(x.chatId)||{}),...x});
  }
  return controls;
 }
 conversations({ownerId=null,query="",includeArchived=false,limit=100}={}){
  const rows=this.store?.list?.()||[],controls=this._conversationControls(),map=new Map();
  for(let i=0;i<rows.length;i++){
    let x=null;try{x=this.store.get(rows[i].id);}catch{}
    if(!x||x.kind!=="chat-turn"||!x.chatId)continue;
    if(x.ownerId&&ownerId&&x.ownerId!==ownerId)continue;
    const cur=map.get(x.chatId)||{chatId:x.chatId,title:null,createdAt:x.createdAt||null,updatedAt:x.createdAt||null,turns:0,attachments:0,evidence:0,preview:""};
    cur.turns+=1;cur.attachments+=(x.attachments||[]).length;cur.evidence+=x.evidenceEnvelope?1:0;
    cur.updatedAt=x.createdAt||cur.updatedAt;cur.preview=String(x.user||x.answer||cur.preview).slice(0,180);
    map.set(x.chatId,cur);
  }
  for(const [chatId,control] of controls){
    if(control.ownerId&&ownerId&&control.ownerId!==ownerId)continue;
    const cur=map.get(chatId)||{chatId,title:null,createdAt:control.createdAt||null,updatedAt:control.createdAt||null,turns:0,attachments:0,evidence:0,preview:""};
    cur.title=control.title??cur.title;cur.archived=control.archived===true;cur.deleted=control.deleted===true;cur.updatedAt=control.createdAt||cur.updatedAt;map.set(chatId,cur);
  }
  let out=[...map.values()].filter(x=>!x.deleted&&(includeArchived||!x.archived));
  const needle=String(query||"").trim().toLowerCase();if(needle)out=out.filter(x=>[x.chatId,x.title,x.preview].some(v=>String(v||"").toLowerCase().includes(needle)));
  out.sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
  return {state:"SUCCESS",conversations:out.slice(0,Math.max(1,Math.min(500,Number(limit)||100))),total:out.length};
 }
 conversationControl(chatId,{ownerId=null,title=undefined,archived=undefined,deleted=undefined}={}){
  const id=String(chatId||"").trim();if(!id)return {state:"BLOCKED",message:"chatId is required."};
  const record=this.store.add({kind:"conversation-control",title:"OneChat conversation control",chatId:id,ownerId:ownerId||null,...(title!==undefined?{title:String(title).trim().slice(0,160)||null}:{}),...(archived!==undefined?{archived:archived===true}:{}),...(deleted!==undefined?{deleted:deleted===true}: {})});
  this.audit?.append({type:"onechat.conversation.control",chatId:id,ownerId:ownerId||null,title:record.title||null,archived:record.archived??null,deleted:record.deleted??null});
  return {state:"SUCCESS",chatId:id,control:{title:record.title||null,archived:record.archived===true,deleted:record.deleted===true,updatedAt:record.createdAt}};
 }
 deleteConversation(chatId,{ownerId=null}={}){
  const id=String(chatId||"").trim();if(!id)return {state:"BLOCKED",message:"chatId is required."};
  const rows=this.store?.list?.()||[],targets=[];
  for(const row of rows){
    let x=null;try{x=this.store.get(row.id);}catch{}
    if(!x||x.chatId!==id)continue;
    if(x.ownerId&&ownerId&&x.ownerId!==ownerId)continue;
    if(["chat-turn","conversation-control"].includes(x.kind))targets.push(row.id);
  }
  for(const rid of targets)this.store.remove(rid);
  this.lastEvidence.delete(id);this.conversation?.histories?.delete?.(id);
  this.audit?.append({type:"onechat.conversation.deleted",chatId:id,ownerId:ownerId||null,recordsDeleted:targets.length,mediaDeleted:false});
  return {state:"SUCCESS",chatId:id,recordsDeleted:targets.length,mediaDeleted:false,message:"Conversation records deleted. Registered media artifacts were retained."};
 }
 exportConversation(chatId,{ownerId=null}={}){
  const id=String(chatId||"").trim(),history=this.history(id,{limit:200,ownerId});
  if(history.state!=="SUCCESS")return history;
  const control=this._conversationControls().get(id)||{};
  if(control.ownerId&&ownerId&&control.ownerId!==ownerId)return {state:"DENIED",message:"Conversation is owned by another identity."};
  return {state:"SUCCESS",format:"uai.onechat.export.v1",exportedAt:new Date().toISOString(),chatId:id,title:control.title||null,archived:control.archived===true,turns:history.turns};
 }
 _safeEvidence(envelope){
  if(!envelope)return null;
  const claims=(envelope.claims||[]).map(c=>({
    claim:String(c.claim||""),
    status:c.status||"UNKNOWN",
    confidence:c.confidence??null,
    support:(c.support||[]).map(x=>({
      source_id:x.source_id||null,
      document_id:x.document_id||null,
      document_revision:x.document_revision??null,
      chunk_id:x.chunk_id||null,
      uri:String(x.uri||"").startsWith("file:")?(x.provenance?.mediaId?"media:"+x.provenance.mediaId:null):(x.uri||null),
      quote:x.quote||null,
      score:x.score??null,
      provenance:{
        ...(x.provenance?.mediaId?{mediaId:x.provenance.mediaId}:{}),
        ...(x.provenance?.modality?{modality:x.provenance.modality}:{}),
        ...(x.provenance?.contentHash?{contentHash:x.provenance.contentHash}:{}),
        ...(x.provenance?.title?{title:x.provenance.title}:{}),
        ...(x.provenance?.publisher?{publisher:x.provenance.publisher}:{}),
        ...(x.provenance?.retrievedAt?{retrievedAt:x.provenance.retrievedAt}:{})
      }
    }))
  }));
  return {id:envelope.id||null,responseId:envelope.responseId||null,promptVersion:envelope.promptVersion||null,model:envelope.model||null,claims,toolCalls:(envelope.toolCalls||[]).map(x=>({agent:x.agent||null,state:x.state||"UNKNOWN",reason:x.reason||null})),integrity:{digest:envelope.integrity?.digest||null}};
 }
 turn(turnId,{ownerId=null}={}){
  const id=String(turnId||"").trim();if(!id)return {state:"BLOCKED",message:"turnId is required."};
  const x=this.store?.get?.(id);if(!x||x.kind!=="chat-turn")return {state:"UNAVAILABLE",message:"Chat turn not found."};
  if(x.ownerId&&ownerId&&x.ownerId!==ownerId)return {state:"DENIED",message:"Chat turn is owned by another identity."};
  const attachments=(x.attachments||[]).map(a=>({id:a.id||null,modality:a.modality||"structured",label:a.label||null,sourceId:a.sourceId||null,mediaType:a.mediaType||null,contentHash:a.contentHash||null,bytes:Number(a.bytes||0)})).filter(a=>a.id);
  return {state:"SUCCESS",turn:{id:x.id,chatId:x.chatId,createdAt:x.createdAt||null,user:String(x.user||""),answer:String(x.answer||""),state:x.state||"UNKNOWN",responseMode:x.responseMode||null,attachments,evidenceEnvelope:this._safeEvidence(x.evidenceEnvelope)}};
 }
 exportTurn(turnId,{ownerId=null}={}){
  const t=this.turn(turnId,{ownerId});if(t.state!=="SUCCESS")return t;
  return {state:"SUCCESS",format:"uai.onechat.turn-export.v1",exportedAt:new Date().toISOString(),turn:t.turn};
 }
 branchFromTurn(turnId,{ownerId=null,includeTurn=true,newChatId=null}={}){
  const target=this.turn(turnId,{ownerId});if(target.state!=="SUCCESS")return target;
  const sourceChatId=target.turn.chatId,branchId=String(newChatId||`chat-${crypto.randomUUID()}`),rows=this.store?.list?.()||[];
  let copied=0;
  for(const row of rows){
    let x=null;try{x=this.store.get(row.id);}catch{}
    if(!x||x.kind!=="chat-turn"||x.chatId!==sourceChatId)continue;
    if(x.ownerId&&ownerId&&x.ownerId!==ownerId)continue;
    if(x.id===turnId&&!includeTurn)break;
    this.store.add({...x,id:undefined,chatId:branchId,ownerId:ownerId||x.ownerId||null,branchedFrom:{chatId:sourceChatId,turnId:x.id}});
    copied++;
    if(x.id===turnId)break;
  }
  this.store.add({kind:"conversation-control",title:"OneChat conversation control",chatId:branchId,ownerId:ownerId||null,title:`Branch of ${sourceChatId.slice(0,24)}`,branchedFrom:{chatId:sourceChatId,turnId}});
  this.audit?.append({type:"onechat.conversation.branched",sourceChatId,sourceTurnId:turnId,newChatId:branchId,ownerId:ownerId||null,copiedTurns:copied,includeTurn:includeTurn===true});
  return {state:"SUCCESS",sourceChatId,sourceTurnId:turnId,chatId:branchId,copiedTurns:copied,includeTurn:includeTurn===true};
 }
 _ensureAutoTitle(chatId,message,ownerId=null){
  const controls=this._conversationControls(),existing=controls.get(chatId);
  if(existing?.title)return existing.title;
  const text=String(message||"").replace(/\s+/g," ").trim();if(!text)return null;
  const title=text.length>72?text.slice(0,69).trimEnd()+"…":text;
  this.store.add({kind:"conversation-control",title:"OneChat conversation control",chatId,ownerId:ownerId||null,title,autoTitle:true});
  return title;
 }
 _previousEvidence(chatId){
  if(this.lastEvidence.has(chatId))return this.lastEvidence.get(chatId);
  try{
    const rows=this.store?.list?.()||[];
    for(let i=rows.length-1;i>=Math.max(0,rows.length-100);i--){const x=this.store.get(rows[i].id);if(x?.kind==="chat-turn"&&x.chatId===chatId&&x.evidenceEnvelope)return x.evidenceEnvelope;}
  }catch{}
  return null;
 }
 allocations(message){
  const t=String(message||""),a=[];
  if(/^(?:plan|run|resume|cancel)\s+task\b|^task\s+status\b|^(?:list|show)\s+tasks\b/i.test(t.trim()))return [{agent:"explorative",reason:"explicit durable task-lifecycle command"}];
  if(/^(?:evaluate|promote|rollback)\s+model\s+run\s+model-run-[\w-]+/i.test(t.trim()))return [{agent:"forgelm",reason:"explicit governed model-candidate lifecycle command"}];
  if(/research|source registry|source snapshot|reference sources|openai|gpt-oss|grok|deepseek|gemma|hugging face|claude|gemini|bixby|darkai|arena/i.test(t))a.push({agent:"research",reason:"model/source research"});
  if(/web|internet|url|common crawl|fineweb|wikipedia|wikimedia|stack exchange|crawl|website/i.test(t)||/\b(?:ingest|fetch|crawl)\b[\s\S]*(?:https?:\/\/|www\.|\b[a-z0-9.-]+\.[a-z]{2,}\b)/i.test(t))a.push({agent:"web-research",reason:"governed web research/corpus intent"});
  if(/\bmemory\b|remember|why remembered|forget source|disable training|disable memory|export memory/i.test(t))a.push({agent:"memory",reason:"explicit user-owned memory intent"});
  if(/provenance graph|lineage|trace provenance|source graph|purge provenance/i.test(t))a.push({agent:"provenance",reason:"provenance graph intent"});
  if(/document|citation|evidence search|retrieval source/i.test(t))a.push({agent:"documents",reason:"provenance-aware document retrieval intent"});
  if(/research|analyse|analyze|compare|definition|knowledge|evidence|study|semantic search|semantic retrieve/i.test(t))a.push({agent:"knowledge",reason:"knowledge/research intent"});
  if(/\bdefine\b|definition of|meaning of|wordnet|lexicon|dictionary|synonym|antonym|hypernym|hyponym|related word|lexical relation/i.test(t))a.push({agent:"lexicon",reason:"local lexical-definition intent"});
  if(/banter|chitchat|chat example|conversation example|dialogue example|oasst|openassistant|casual reply|humorous reply|technical banter/i.test(t))a.push({agent:"dialogue",reason:"local conversational-corpus intent"});
  if(/build|develop|implement|code|repair|update|upgrade|repository|proposal|stage|promote|rollback/i.test(t))a.push({agent:"development",reason:"governed development intent"});
  if(/forgelm|local model|model status|neural|train model|language model|checkpoint|tokenizer/i.test(t))a.push({agent:"forgelm",reason:"local neural-model intent"});
  if(/learning|training data|dataset|verified trace|prepare corpus/i.test(t))a.push({agent:"learning",reason:"learning-fabric intent"});
  if(/agent|orchestrate|collaborat|workflow|task\b|resume task|cancel task|action envelope/i.test(t))a.push({agent:"explorative",reason:"agent/orchestration/task-lifecycle intent"});
  if(/account|subscription|billing|plugin|model registry|runtime model|llama|gguf|observability|metrics|capabilit|availability|approval|policy|autonomy|lease|data lifecycle|retention|delete source|system status|dependencies|hardware|release integrity|langgraph|oxford|fabricat|octoprint|storage database|sqlite|what (?:else )?can you do|what can you do|help me use|available features/i.test(t))a.push({agent:"systems",reason:"system-service intent"});
  if(!a.length)a.push({agent:"conversation",reason:"general conversational response"});
  return a.filter((x,i)=>a.findIndex(y=>y.agent===x.agent)===i);
 }
 async execute(agent,message,chatId=null,context={}){
  if(agent==="conversation")return this.conversation?this.conversation.chat({chatId,message}):result("UNAVAILABLE","Conversational model engine is not configured.");
  if(agent==="web-research"){
    if(/^(?:can|could|do) you (?:search|browse|access|use) (?:the )?(?:web|internet)\??$/i.test(String(message).trim())){
      if(!this.webResearch)return result("UNAVAILABLE","Web research is not configured in this build.");
      const probe=await this.webResearch.search("open source software",{limit:1});
      if(probe.state==="SUCCESS")return result("SUCCESS",`Yes. Live web search is reachable through ${(probe.providers||[]).join(", ")||"the configured search path"}. Web content is treated as untrusted evidence and does not gain authority over UAI.`,{providers:probe.providers||[],structuredProvider:probe.structuredProvider||"UNAVAILABLE"});
      const detail=(probe.errors||[]).map(x=>x.engine+": "+x.message).slice(0,3).join("; ");
      return result("UNAVAILABLE",`Web research is configured, but live search is not reachable from this device right now${detail?": "+detail:"."}`,{errors:probe.errors||[],structuredProvider:probe.structuredProvider||"UNAVAILABLE"});
    }
    if(/web corpus status|web sources|source classes|common crawl|fineweb|wikimedia|wikipedia|stack exchange/i.test(message)){const s=this.webCorpus?.status();return s?{...s,message:`Web corpus registry contains ${s.sourceClasses} governed source classes and ${s.records} locally ingested record(s).`}:result("UNAVAILABLE","Web corpus service is not configured.");}
    const m=String(message).match(/(?:ingest|fetch|research|crawl)(?:\s+url)?\s+((?:https?:\/\/|www\.)\S+|[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/\S*)?)(?:\s+license\s+([A-Za-z0-9_.+-]+))?/i);
    if(m){
      const target=/^https?:\/\//i.test(m[1])?m[1]:"https://"+m[1];
      return this.webCorpus?await this.webCorpus.ingestUrl({url:target,license:m[2]||"UNKNOWN",licenseSource:m[2]?"USER_DECLARED":"UNVERIFIED",promoteTraining:/training[- ]approved/i.test(message)}):result("UNAVAILABLE","Web corpus service is not configured.");
    }
    return result("SUCCESS","Web Research Agent is ready. Ask for web corpus status or `ingest url https://...`; fetched content keeps URL, retrieval time, robots result, license state and training eligibility.");
  }
  if(agent==="documents"){
    if(!this.documentStore)return result("UNAVAILABLE","Provenance document store is not configured.");
    if(/document(?: data)? plane status|document store status|documents status/i.test(message)){const s=await this.documentStore.status();return {...s,message:"Document data plane contains "+(s.documents||0)+" document revision(s) and "+(s.chunks||0)+" chunk(s)."};}
    if(/(?:list|show)\s+documents/i.test(message)){const s=await this.documentStore.list({limit:50});return result(s.state||"SUCCESS",(s.documents?.length||0)+" document revision(s) are visible in the local data plane.",s);}
    const get=String(message).match(/(?:show|get|inspect)\s+document\s+(doc-[\w-]+)/i);if(get)return this.documentStore.get(get[1]);
    const del=String(message).match(/(?:forget|delete|soft delete)\s+document\s+(doc-[\w-]+)/i);if(del)return this.documentStore.delete(del[1],"OneChat user-requested deletion");
    const purge=String(message).match(/purge\s+document\s+(doc-[\w-]+)/i);if(purge)return this.documentStore.purge(purge[1],"OneChat user-requested purge");
    const q=String(message).match(/(?:document|evidence|provenance)\s+(?:search|retrieve|find)\s+(.+)/i);if(q)return this.documentStore.search(q[1].trim(),8);
    return result("SUCCESS","Document agent is ready. Ask for document data plane status, list documents, or document search <query>.",{commands:["document data plane status","list documents","document search <query>","show document <doc-id>"]});
  }
  if(agent==="memory"){
    if(!this.memoryStore)return result("UNAVAILABLE","User-owned memory store is not configured.");const ownerId=context.ownerId;if(!ownerId)return result("DENIED","Authenticated owner identity is required for memory operations.");
    if(/^(?:show|list)\s+memory\b|what do you remember about me/i.test(message)){const items=this.memoryStore.list({ownerId,limit:100});return result("SUCCESS",`${items.length} active owner memory item(s).`,{items,settings:this.memoryStore.settings(ownerId)});}
    const why=String(message).match(/why\s+(?:do you\s+)?remember(?:ed)?\s+(memory-[\w-]+)/i);if(why)return this.memoryStore.why(why[1],ownerId);
    const forgetSource=String(message).match(/forget\s+(?:everything\s+from\s+)?source\s+([^\n]+)/i);if(forgetSource)return this.memoryStore.forgetSource(forgetSource[1].trim(),ownerId,"explicit OneChat forget-source command");
    const forget=String(message).match(/forget\s+(memory-[\w-]+)/i);if(forget)return this.memoryStore.forget(forget[1],ownerId,"explicit OneChat forget command");
    if(/disable\s+memory/i.test(message))return this.memoryStore.setSettings(ownerId,{memoryEnabled:false});
    if(/enable\s+memory/i.test(message))return this.memoryStore.setSettings(ownerId,{memoryEnabled:true});
    if(/disable\s+training/i.test(message))return this.memoryStore.setSettings(ownerId,{trainingEnabled:false});
    if(/enable\s+training/i.test(message))return this.memoryStore.setSettings(ownerId,{trainingEnabled:true});
    if(/export\s+memory/i.test(message))return this.memoryStore.export(ownerId);
    const search=String(message).match(/memory\s+(?:search|find)\s+([\s\S]+)/i);if(search)return this.memoryStore.search(search[1].trim(),{ownerId,limit:20});
    const remember=String(message).match(/^remember(?:\s+that)?\s+([\s\S]+)/i);if(remember)return this.memoryStore.remember({ownerId,namespace:"user",sourceId:"user:onechat",text:remember[1].trim(),consent:true,reason:"explicit OneChat remember command",trainingAllowed:false});
    return result("SUCCESS","Memory commands are explicit only. Use: remember <text>, show memory, why remembered <memory-id>, forget <memory-id>, forget source <source>, export memory, disable memory, or disable training.",{settings:this.memoryStore.settings(ownerId)});
  }
  if(agent==="provenance"){
    if(!this.provenanceGraph)return result("UNAVAILABLE","Provenance graph is not configured.");
    if(/provenance\s+(?:graph\s+)?status/i.test(message))return this.provenanceGraph.status();
    const trace=String(message).match(/(?:trace\s+provenance|provenance\s+trace)\s+(prov-node-[\w-]+)/i);if(trace)return this.provenanceGraph.trace(trace[1],{direction:"both",depth:6});
    const purge=String(message).match(/purge\s+provenance\s+(prov-node-[\w-]+)/i);if(purge)return this.provenanceGraph.planPurge(purge[1]);
    return result("SUCCESS","Provenance graph is ready. Use provenance graph status, trace provenance <node-id>, or purge provenance <node-id> for a dry-run deletion plan.");
  }
  if(agent==="lexicon"){
    if(!this.storageDb)return result("UNAVAILABLE","SQLite language database is not configured.");
    const relm=String(message).match(/(?:synonyms?|antonyms?|hypernyms?|hyponyms?|related(?:\s+words?)?)\s+(?:for|of|to)?\s*([^?!.\n]+)/i);
    if(relm){const map={synonym:"similar-to",synonyms:"similar-to",antonym:"antonym",antonyms:"antonym",hypernym:"hypernym",hypernyms:"hypernym",hyponym:"hyponym",hyponyms:"hyponym"};const key=relm[0].trim().split(/\s+/)[0].toLowerCase();return this.storageDb.related(relm[1].trim(),map[key]||"",12);}
    const m=String(message).match(/(?:define|definition of|meaning of)\s+([^?!.\n]+)/i);const term=(m?m[1]:message).trim();
    return this.storageDb.define(term,8);
  }
  if(agent==="dialogue"){
    if(!this.storageDb)return result("UNAVAILABLE","SQLite language database is not configured.");
    const m=String(message).match(/(?:banter|chitchat|conversation|dialogue)(?:\s+(?:about|on|for))?\s*(.*)$/i);let query=(m?.[1]||"").trim();let style="";const sm=query.match(/\bstyle\s+(casual|technical|humorous|enthusiastic|short|question)(?:\s*,\s*(casual|technical|humorous|enthusiastic|short|question))*/i);if(sm){style=sm[0].replace(/^style\s+/i,"");query=query.replace(sm[0],"").trim();}return this.storageDb.banter(query,8,style);
  }
  if(agent==="forgelm"){
    const ownerId=context.ownerId||null;
    const approvalId=(String(message).match(/\bapproval\s+(approval-[\w-]+)/i)||[])[1]||null;
    const authorizeHighRisk=(operation,args,label="model operation")=>{
      if(!ownerId)return {state:"DENIED",message:"Authenticated owner identity is required for "+label+"."};
      if(!this.approvalStore)return {state:"BLOCKED",message:"Approval store is not configured; "+label+" cannot run."};
      const binding={operation,arguments:args,capability:"models.execute",actor:ownerId,toolVersion:"onechat-model-lifecycle-v1",actionEnvelopeId:null,taskId:null};
      if(!approvalId){
        const approval=this.approvalStore.request({...binding,risk:"high"});
        return {state:"ASK",message:"Explicit approval is required before "+label+".",approval,binding};
      }
      const checked=this.approvalStore.validate(approvalId,binding);
      if(checked.state!=="SUCCESS")return {...checked,message:checked.message||("Approval was not valid for this exact "+label+".")};
      return {state:"SUCCESS",binding,approval:checked.approval||null};
    };
    const lifecycle=String(message).match(/\b(evaluate|promote|rollback)\s+model\s+run\s+(model-run-[\w-]+)/i);
    if(lifecycle&&this.modelLab){
      const action=lifecycle[1].toLowerCase(),runId=lifecycle[2];
      if(action==="evaluate"){
        const thresholdMatch=String(message).match(/(?:max\s+regression|threshold)\s+([0-9]*\.?[0-9]+)/i);
        const maxRelativeRegression=thresholdMatch?Math.max(0,Math.min(1,Number(thresholdMatch[1]))):0.02;
        return this.modelLab.evaluateCandidate(runId,{maxRelativeRegression});
      }
      if(action==="promote"){
        const gate=authorizeHighRisk("onechat.model.promote",{runId},"model promotion");
        if(gate.state!=="SUCCESS")return gate;
        return this.modelLab.promoteCandidate(runId,{approved:true,approvalId});
      }
      const reasonMatch=String(message).match(/\breason\s+(.+?)(?:\s+approval\s+approval-[\w-]+|$)/i);
      const reason=(reasonMatch?.[1]||"owner-requested rollback").trim();
      const gate=authorizeHighRisk("onechat.model.rollback",{runId,reason},"model rollback");
      if(gate.state!=="SUCCESS")return gate;
      return this.modelLab.rollback(runId,{reason});
    }
    if(/train\s+tokenizer|tokenizer\s+train/i.test(message)&&this.modelLab){
      const n=Number((message.match(/(\d+)/)||[])[1]||512),vocabSize=Math.max(280,Math.min(n,32000));
      const gate=authorizeHighRisk("onechat.model.tokenizer.train",{vocabSize},"tokenizer training");
      if(gate.state!=="SUCCESS")return gate;
      return this.modelLab.trainTokenizer(vocabSize);
    }
    if(/train/i.test(message)){
      const n=Number((message.match(/(\d+)\s*steps?/i)||[])[1]||40),steps=Math.max(1,Math.min(n,10000));
      const pm=message.match(/preset\s+([\w-]+)/i),preset=pm?pm[1]:"termux-tiny";
      const gate=authorizeHighRisk("onechat.model.train",{steps,preset},"model training");
      if(gate.state!=="SUCCESS")return gate;
      return this.modelLab?this.modelLab.train({steps,preset}):this.forgelm.train(steps,{preset});
    }
    if(/benchmark/i.test(message)&&this.modelLab)return this.modelLab.benchmark();
    if(/presets?|model lab/i.test(message)&&this.modelLab)return this.modelLab.status();
    if(/status|checkpoint/i.test(message)){const s=await this.forgelm.status();return {...s,message:s.state==="SUCCESS"?`ForgeLM runtime ${s.state}; checkpoint ${s.checkpointExists?"is available":"is not available"}; device ${s.device||"unknown"}.`:(s.message||"ForgeLM status unavailable.")};}
    return this.forgelm.chat(message,64);
  }
  if(agent==="learning"){
    if(/prepare|dataset|training data|corpus/i.test(message)&&this.modelLab)return this.modelLab.prepareDataset();
    return /export|build|dataset|training data/i.test(message)?this.learning.build():result("SUCCESS","Learning agent is ready. Ask to prepare the verified ForgeLM dataset.",{file:this.learning.file});
  }
  if(agent==="research"){
    if(/source snapshot|analy[sz]e reference sources|inspect reference sources/i.test(message)&&this.modelLab)return this.modelLab.analyzeSources();
    const hits=this.sourceRegistry.filter(x=>new RegExp(x.name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"i").test(message)||message.toLowerCase().includes((x.name.split(" ")[0]||"").toLowerCase()));
    return result("SUCCESS",hits.length?`Matched ${hits.length} registered research source(s).`:"No named source matched; returning the governed source registry boundary.",{sources:hits.length?hits:this.sourceRegistry});
  }
  if(agent==="explorative"){
    if(/list\s+agents|show\s+agents/i.test(message))return result("SUCCESS",`${this.agents.list().length} logical agents registered.`,{agents:this.agents.list()});
    const spawn=ids(message,/spawn\s+agent\s+([^\n,]+)(?:,?\s*capabilities?\s*:?\s*([\w., -]+))?/i);if(spawn){const caps=(spawn[1]||"").split(/[ ,]+/).map(x=>x.trim()).filter(Boolean);return this.agents.spawn({parentId:"explorative",name:spawn[0].trim(),role:"derived-specialist",capabilities:caps});}
    if(this.tasks){
      const status=String(message).match(/task\s+status\s+(task-[\w-]+)/i);if(status)return this.tasks.status(status[1]);
      const resume=String(message).match(/resume\s+task\s+(task-[\w-]+)/i);if(resume)return this.tasks.resume(resume[1]);
      const cancel=String(message).match(/cancel\s+task\s+(task-[\w-]+)/i);if(cancel)return this.tasks.cancel(cancel[1]);
      if(/(?:list|show)\s+tasks/i.test(message)){const tasks=this.tasks.list({limit:20});return result("SUCCESS",`There are ${tasks.length} persisted task(s) in the current view.`,{tasks});}
      const run=String(message).match(/run\s+task\s*:?\s*([\s\S]+)/i);if(run)return this.tasks.run({request:run[1].trim()});
      const plan=String(message).match(/plan\s+task\s*:?\s*([\s\S]+)/i);if(plan){const p=this.tasks.plan(plan[1].trim());return result(p.state,`Task plan contains ${p.steps.length} step(s).`,{plan:p});}
    }
    return this.explorative?.chat?this.explorative.chat(message):result("UNAVAILABLE","Explorative agent is not configured.");
  }
  if(agent==="knowledge"){
    const sem=String(message).match(/semantic\s+(?:search|retrieve)\s+(.+)/i);if(sem&&this.storageDb?.semanticSearch)return this.storageDb.semanticSearch(sem[1].trim(),"all",8);
    const cmp=ids(message,/compare\s+definition\s+([^:]+):\s*([\s\S]+)/i);if(cmp)return this.knowledge.compareDefinition(cmp[0].trim(),cmp[1].trim());
    if(/^(research|study)\s*:/i.test(message))return this.research.examine({title:"OneChat research note",source:"user:onechat",text:message.replace(/^[^:]+:/,"").trim()});
    return this.explorative?.chat?this.explorative.chat(message):result("UNAVAILABLE","Knowledge/explorative agent is not configured.");
  }
  if(agent==="development"){
    const stage=ids(message,/stage\s+proposal\s+([\w-]+)/i);if(stage)return this.selfdev.stage(stage[0]);
    const promote=ids(message,/promote\s+stage\s+([\w-]+)\s+approval\s+([\w-]+)/i);if(promote)return this.selfdev.promote(promote[0],promote[1]);
    const d=parseDevelop(message);if(d)return this.development.propose({request:`OneChat file development: ${d.path}`,path:d.path,content:d.content});
    return this.development.propose({request:message});
  }
  if(agent==="systems"){
    if(/what (?:else )?can you do|what can you do|help me use|available features/i.test(message)&&this.capabilityStatus){
      const caps=await this.capabilityStatus(),connected=caps.filter(x=>x.availability==="CONNECTED"),configured=caps.filter(x=>x.availability==="CONFIGURED"),unavailable=caps.filter(x=>!["CONNECTED","CONFIGURED"].includes(x.availability));
      const groups=[["chat",/onechat|forgelm/i],["knowledge",/knowledge|document|memory|retrieval|lexicon/i],["web",/web|research/i],["multimodal",/vision|audio|speech|video|multimodal|media/i],["development",/develop|plugin|github|task|action/i],["governance",/policy|approval|audit|provenance|security|capabilit/i]]
        .map(([name,re])=>({name,count:connected.filter(x=>re.test(x.id)).length})).filter(x=>x.count);
      return result("SUCCESS",`I currently have ${connected.length}/${caps.length} capabilities CONNECTED${configured.length?", "+configured.length+" CONFIGURED":""}. Active areas: ${groups.map(x=>x.name+" ("+x.count+")").join(", ")||"local orchestration"}. I can chat, retrieve governed local knowledge, work with attachments/multimodal runtimes when their checkpoints are available, research the web when network search is reachable, manage tasks/actions, inspect provenance/evidence, and perform approval-gated development. I will report unavailable functions instead of pretending they ran.`,{connected:connected.length,total:caps.length,configured:configured.length,unavailable:unavailable.map(x=>({id:x.id,availability:x.availability,reason:x.reason}))});
    }
    if(/(?:show|list)\s+approvals?/i.test(message)&&this.approvalStore){const approvals=this.approvalStore.list({limit:50});return result("SUCCESS",`${approvals.length} approval record(s).`,{approvals});}
    const approvalDecision=String(message).match(/\b(approve|deny)\s+(approval-[\w-]+)/i);if(approvalDecision&&this.approvalStore)return this.approvalStore.decide(approvalDecision[2],approvalDecision[1].toUpperCase()==="APPROVE"?"APPROVE":"DENY");
    if(/(?:simulate policy|policy simulation|dry run)/i.test(message)&&this.policySimulator){const risk=(message.match(/\b(low|medium|high|critical)\b/i)||[])[1]||"low";return this.policySimulator.simulate({actor:context.ownerId||"user:onechat",objective:message,steps:[{operation:"onechat.proposed-workflow",description:message,risk,physical:/physical|fabricat/i.test(message),mutatesSource:/source|code|mutat|develop/i.test(message),external:/external|api|web|send|upload/i.test(message),requiresCredential:/credential|account|billing|secret/i.test(message),dataClassification:/secret/i.test(message)?"secret":/private|personal/i.test(message)?"private":"local"}]});}
    if(/policy/i.test(message)&&this.policyEngine){const risk=(message.match(/\b(low|medium|high|critical)\b/i)||[])[1]||"low";return this.policyEngine.evaluate({operation:message,risk,actor:context.ownerId||null,physical:/physical|fabricat/i.test(message),mutatesSource:/source|code|mutat|develop/i.test(message),external:/external|api|web/i.test(message),requiresCredential:/credential|account|billing/i.test(message)});}
    if(/(?:show|list)\s+autonomy|autonomy\s+status/i.test(message)&&this.autonomyStore){const leases=this.autonomyStore.list();return result("SUCCESS",`${leases.length} autonomy lease(s).`,{leases});}
    const revokeLease=String(message).match(/revoke\s+autonomy\s+(lease-[\w-]+)/i);if(revokeLease&&this.autonomyStore)return this.autonomyStore.revoke(revokeLease[1]);
    const grantLease=String(message).match(/grant\s+autonomy(?:\s+scope\s+([\w.,-]+))?(?:\s+max\s+(\d+))?(?:\s+(\d+)\s+minutes?)?/i);if(grantLease&&this.autonomyStore){const scope=(grantLease[1]||"explore,research").split(',').filter(Boolean);const maxActions=Math.min(1000,Math.max(1,Number(grantLease[2]||10)));const minutes=Math.min(1440,Math.max(1,Number(grantLease[3]||60)));return this.autonomyStore.grant({scope,riskCeiling:"medium",maxActions,durationMs:minutes*60000});}
    if(/availability/i.test(message)&&this.availabilityStatus){const s=await this.availabilityStatus();return result("SUCCESS",`Availability evidence snapshot: ${s.connected}/${s.total} core capabilities CONNECTED${s.configured?`, ${s.configured} CONFIGURED`:""}.`,{availability:s});}
    if(/model registry|runtime model/i.test(message)&&this.modelRegistry){const s=this.modelRegistry.status();return result("SUCCESS",`Model registry tracks ${s.models.length} model/runtime entries without treating registration as runtime availability.`,s);}
    if(/model route|route model|select model/i.test(message)&&this.modelRouter){const task=(message.match(/\b(chat|reasoning|planning|summarization|classification)\b/i)||[])[1]||"chat";const r=await this.modelRouter.route({task:task.toLowerCase(),modality:"text",privacy:"local-only",offline:/offline/i.test(message)});if(r.ranked)delete r.ranked;return result(r.state,r.state==="SUCCESS"?`Model router selected ${r.selected.id} via ${r.selected.provider}.`:(r.message||"No connected model satisfies the route."),r);}    if(/llama|gguf/i.test(message)&&this.llamaRuntime){const s=await this.llamaRuntime.status();return result(s.availability==="CONNECTED"?"SUCCESS":s.availability,s.availability==="CONNECTED"?`llama.cpp runtime is connected with ${s.models?.length||0} loaded model record(s).`:(s.reason||"llama.cpp runtime unavailable."),s);}
    if(/observability|metrics/i.test(message)&&this.observability)return this.observability.summary();
    if(/plugin/i.test(message)&&this.pluginRegistry){const plugins=this.pluginRegistry.list();return result("SUCCESS",`${plugins.length} v1 plugin manifest(s) are registered. Third-party execution remains sandbox-gated.`,{plugins});}
    if(/data lifecycle|retention/i.test(message)&&this.storageDb?.lifecycleStatus)return this.storageDb.lifecycleStatus();
    const ds=String(message).match(/(?:delete|soft delete)\s+source\s+([\w.-]+)/i);if(ds&&this.storageDb?.deleteSource)return this.storageDb.deleteSource(ds[1]);
    if(/storage database|sqlite/i.test(message)&&this.storageDb){const s=await this.storageDb.status();return {...s,message:s.state==="SUCCESS"?`SQLite storage is ready with ${s.counts?.definitions||0} definitions and ${s.counts?.dialogue_messages||0} dialogue messages.`:(s.message||"Storage database unavailable.")};}
    if(/hardware/i.test(message)&&this.modelLab)return this.modelLab.hardware();
    if(/release integrity/i.test(message))return result("SUCCESS","Release integrity is exposed in the live /api/status evidence and verified against the shipped manifest.");
    if(/dependencies/i.test(message)){const d=this.dependencyStatus();return result(d.state||"UNKNOWN",`Neural dependency scan completed. ${Object.values(d.dependencies||{}).filter(x=>x==="CONNECTED").length} Python dependency modules are currently importable.`,d);}
    if(/(?:probe|activate|check)\s+capabilit/i.test(message)&&this.runtimeServices){const services=await this.runtimeServices.probe();const lg=this.langgraph?await this.langgraph.status():null;const caps=this.capabilityStatus?await this.capabilityStatus():[];return result("SUCCESS",`Capability probe completed: ${caps.filter(x=>x.availability==="CONNECTED").length}/${caps.length} core capabilities are CONNECTED.`,{services,langgraph:lg,capabilities:caps});}
    if(/capabilit/i.test(message)&&this.capabilityStatus){const caps=await this.capabilityStatus();const connected=caps.filter(x=>x.availability==="CONNECTED");const configured=caps.filter(x=>x.availability==="CONFIGURED");const missing=caps.filter(x=>!["CONNECTED","CONFIGURED"].includes(x.availability));return result("SUCCESS",`${connected.length}/${caps.length} core capabilities are CONNECTED${configured.length?`, with ${configured.length} additional CONFIGURED`:""}.`,{connected:connected.length,total:caps.length,configured:configured.length,missing:missing.map(x=>({id:x.id,availability:x.availability,reason:x.reason}))});}
    if(/langgraph/i.test(message)&&this.langgraph){if(/run|workflow|execute/i.test(message))return this.langgraph.run(message);const s=await this.langgraph.status();return result(s.availability==="CONNECTED"?"SUCCESS":"UNAVAILABLE",s.reason,s);}
    if(/oxford/i.test(message)&&this.runtimeServices){const m=String(message).match(/oxford\s+compare\s+([^:]+):\s*([\s\S]+)/i);if(m)return this.runtimeServices.oxford.compare(m[1].trim(),m[2].trim());const s=this.runtimeServices.oxford.status();return result(s.availability==="CONNECTED"?"SUCCESS":s.availability,s.reason,s);}
    if(/fabricat|octoprint/i.test(message)&&this.runtimeServices){if(/probe|connect|status/i.test(message)){const r=/probe|connect/i.test(message)?await this.runtimeServices.fabrication.probe():this.runtimeServices.fabrication.status();return r.state? r : result(r.availability==="CONNECTED"?"SUCCESS":r.availability,r.reason,r);}const s=this.runtimeServices.fabrication.status();return result(s.availability==="CONNECTED"?"SUCCESS":s.availability,"Physical job execution is only exposed through the approval-gated fabrication adapter; ask for fabrication status/probe first.",s);}
    if(/accounts?/i.test(message))return result("SUCCESS",`${this.control.accounts.list().length} local account record(s).`,{accounts:this.control.accounts.list()});
    if(/subscriptions?|billing/i.test(message)){if(this.runtimeServices&&/live|stripe|billing/i.test(message)){const s=this.runtimeServices.billing.status();if(s.availability==="CONNECTED")return this.runtimeServices.billing.list({limit:10,status:"all"});return result(s.availability,s.reason,{liveBilling:s});}return result("SUCCESS",`${this.control.subscriptions.list().length} user-recorded subscription(s).`,{subscriptions:this.control.subscriptions.list(),liveBilling:this.runtimeServices?.billing?.status?.()||null});}
    if(/plugins?/i.test(message))return result("SUCCESS",`${this.control.plugins.list().length} plugin manifest(s).`,{plugins:this.control.plugins.list()});
    return result("SUCCESS","Systems agent is connected to local registries and capability adapters. Ask for capabilities, dependencies, LangGraph, Oxford, billing, fabrication, accounts, subscriptions or plugins.");
  }
  return result("UNAVAILABLE",`No executable collaboration route for agent ${agent}.`);
 }
 async handle(input={}){
  const emit=e=>input.onEvent?.(e),signal=input.signal||null;
  const cancelled=()=>signal?.aborted===true;
  const message=String(input.message||"").trim();if(!message)return {state:"BLOCKED",message:"Chat message is empty.",allocations:[],contributions:[]};
  if(cancelled())return {state:"CANCELLED",message:"Turn cancelled before execution.",allocations:[],contributions:[]};
  emit({type:"phase",phase:"intent",message:"Understanding the request."});
  const chatId=input.chatId||`chat-${crypto.randomUUID()}`,intent=this._intent(message,chatId);
  if(/^explain\s+answer[.! ]*$/i.test(message)){
    const prior=this._previousEvidence(chatId);
    if(!prior)return {state:"UNAVAILABLE",chatId,message:"No prior answer evidence is available for this chat yet.",responseMode:"evidence-explanation",evidenceEnvelope:null,allocations:[],contributions:[]};
    const summary=prior.claims?.reduce((m,x)=>(m[x.status]=(m[x.status]||0)+1,m),{})||{};
    const sources=(prior.claims||[]).flatMap(x=>x.support||[]).filter(x=>x.source_id||x.chunk_id);
    return {state:"SUCCESS",chatId,message:`Previous answer evidence: ${prior.claims?.length||0} claim(s); statuses ${JSON.stringify(summary)}; ${sources.length} cited source chunk(s); model ${prior.model?.id||prior.model?.provider||"none"}.`,responseMode:"evidence-explanation",modelUsed:Boolean(prior.model),evidenceEnvelope:prior,allocations:[],contributions:[],truth:"This explanation exposes structured evidence and execution metadata, not private chain-of-thought."};
  }
  const routing=input.routing||{allowCloud:input.allowCloud===true,provider:input.provider||null,model:input.model||null,task:input.task||null,modality:input.modality||null,maxTokens:input.maxTokens||null,temperature:input.temperature};
  emit({type:"phase",phase:"attachments",message:"Preparing governed attachments."});
  const prepared=await this._prepareAttachments({...input,chatId});
  if(prepared.state!=="SUCCESS")return {state:prepared.state,chatId,message:prepared.message||"Attachment preparation failed.",responseMode:"multimodal-attachment-error",allocations:[],contributions:[],attachments:prepared.artifacts||[]};
  if(cancelled())return {state:"CANCELLED",chatId,message:"Turn cancelled after attachment preparation.",allocations:[],contributions:[],attachments:prepared.artifacts||[]};
  const hasAttachments=(prepared.artifacts||[]).length>0;
  let allocations=this.allocations(message),contributions=[],researchContext=null;
  emit({type:"allocations",allocations,message:"Collaborators allocated."});
  if(intent.research&&this.webResearch){
    emit({type:"tool",agent:"web-research",state:"RUNNING",message:"Researching governed web evidence."});
    researchContext=await this.webResearch.research(message,{maxSources:Number(input.maxResearchSources||6)});
    emit({type:"tool",agent:"web-research",state:researchContext?.state||"SUCCESS",message:"Web research phase completed."});
    contributions.push({agent:"web-research",reason:"live governed multi-source research",result:{...researchContext,context:undefined}});
    allocations=[...allocations.filter(x=>x.agent!=="web-research"&&x.agent!=="conversation"),{agent:"conversation",reason:"synthesize the researched evidence into one natural answer"}];
  }else if(intent.followup&&!allocations.some(x=>x.agent==="conversation")){
    allocations=[...allocations,{agent:"conversation",reason:"maintain conversational continuity for the follow-up"}];
  }
  if(hasAttachments&&!allocations.some(x=>x.agent==="conversation"))allocations=[...allocations,{agent:"conversation",reason:"synthesize local multimodal attachment evidence with conversational history"}];
  for(const a of allocations){
    if(cancelled())return {state:"CANCELLED",chatId,message:"Turn cancelled during collaboration.",allocations,contributions,attachments:prepared.artifacts||[]};
    emit({type:"tool",agent:a.agent,state:"RUNNING",reason:a.reason,message:`${a.agent} started.`});
    const executed=a.agent==="conversation"&&this.conversation
      ?(hasAttachments
        ?await this.conversation.chatMultimodal({chatId,message,attachments:prepared.media,document:prepared.document,researchContext,maxTokens:routing.maxTokens||256,signal,onEvent:emit})
        :await this.conversation.chat({chatId,message,researchContext,routing,signal,onEvent:emit}))
      :await this.execute(a.agent,message,chatId,{ownerId:input.ownerId||null});
    contributions.push({agent:a.agent,reason:a.reason,result:executed});
    emit({type:"tool",agent:a.agent,state:executed?.state||"UNKNOWN",reason:a.reason,message:`${a.agent} ${String(executed?.state||"UNKNOWN").toLowerCase()}.`});
  }
  if(cancelled())return {state:"CANCELLED",chatId,message:"Turn cancelled before verification.",allocations,contributions,attachments:prepared.artifacts||[]};
  emit({type:"phase",phase:"verify",message:"Verifying result states and evidence."});
  const failed=contributions.filter(x=>!ok(x.result?.state));const verification=result(failed.length?"PARTIAL":"SUCCESS",failed.length?`${failed.length} collaborating result(s) were not successful; see evidence. All result states are preserved.`:"Verification passed for the operations executed in this turn.",{checked:contributions.map(x=>({agent:x.agent,state:x.result?.state||"UNKNOWN"}))});
  contributions.push({agent:"verifier",reason:"truth-state verification",result:verification});
  const ranked=contributions.filter(x=>x.agent!=="verifier").map(x=>x.result).sort((a,b)=>(stateRank.get(b.state)||0)-(stateRank.get(a.state)||0));const best=ranked[0]||verification;
  const composed=this.responseComposer.compose({message,allocations,contributions});
  const answer=composed.message||best.message||"Collaboration completed.";
  const finalState=failed.length?(ranked.some(x=>x.state==="SUCCESS")?"PARTIAL":best.state):"SUCCESS";
  const responseId=`response-${crypto.randomUUID()}`;
  const researchSupport=(researchContext?.sources||[]).map(x=>({source_id:`web:${x.publisher||x.label}`,document_id:null,document_revision:null,chunk_id:x.label,uri:x.url,quote:null,score:x.relevance??null,provenance:{title:x.title,publisher:x.publisher,retrievedAt:x.retrievedAt,researchRunId:researchContext.runId}}));
  const attachmentSupport=(prepared.evidence||[]).map(x=>({source_id:x.source_id||null,document_id:null,document_revision:null,chunk_id:null,uri:x.uri||null,quote:null,score:null,provenance:x.provenance||{}}));
  const support=[...(composed.evidence?.sources||[]).map(x=>({source_id:x.sourceId||x.source_id||null,document_id:x.documentId||x.document_id||null,document_revision:x.revision??x.document_revision??null,chunk_id:x.chunkId||x.chunk_id||null,uri:x.uri||null,quote:x.quote||null,score:x.score??null,provenance:x.provenance||{}})),...researchSupport,...attachmentSupport];
  const conversationResult=contributions.find(x=>x.agent==="conversation")?.result||null;
  const claimStatus=support.length?"SUPPORTED":(composed.mode==="native-conversation"||composed.mode==="governed-composer"?"INFERENCE":(finalState==="SUCCESS"?"INFERENCE":"UNSUPPORTED"));
  const evidenceEnvelope=new EvidenceEnvelope({
    responseId,answer,
    model:conversationResult?.modelUsed?{id:conversationResult.model||conversationResult.modelRoute?.selected?.id||null,provider:conversationResult.runtime||conversationResult.modelRoute?.selected?.provider||null,route:conversationResult.modelRoute||null}:null,
    promptVersion:"onechat-v0.51",
    claims:[{claim:answer,support,status:claimStatus,confidence:null}],
    toolCalls:contributions.filter(x=>x.agent!=="verifier"&&x.agent!=="conversation").map(x=>({agent:x.agent,state:x.result?.state||"UNKNOWN",reason:x.reason})),
    metadata:{chatId,responseMode:composed.mode,finalState,researchRunId:researchContext?.runId||null,attachments:(prepared.artifacts||[]).map(x=>({id:x.id,modality:x.modality,contentHash:x.contentHash}))}
  });
  if(cancelled())return {state:"CANCELLED",chatId,message:"Turn cancelled before persistence; result was not saved.",allocations,contributions,attachments:prepared.artifacts||[]};
  this.lastEvidence.set(chatId,evidenceEnvelope);
  const record=this.store.add({kind:"chat-turn",title:"OneChat turn",chatId,ownerId:input.ownerId||null,user:message,allocations,contributions,state:finalState,answer,responseMode:composed.mode,evidenceEnvelope,attachments:prepared.artifacts||[],verified:finalState==="SUCCESS"});
  this._ensureAutoTitle(chatId,message,input.ownerId||null);
  this.audit?.append({type:"onechat.turn",chatId,responseId,evidenceId:evidenceEnvelope.id,evidenceDigest:evidenceEnvelope.integrity.digest,knowledgeId:record.id,allocations:allocations.map(x=>x.agent),state:finalState,responseMode:composed.mode});
  emit({type:"persisted",state:finalState,knowledgeId:record.id,responseId,evidenceId:evidenceEnvelope.id,message:"Turn persisted with evidence."});
  return {state:finalState,chatId,responseId,message:answer,responseMode:composed.mode,modelUsed:composed.modelUsed===true,modelQuality:composed.quality||null,evidence:composed.evidence||null,evidenceEnvelope,attachments:prepared.artifacts||[],allocations,contributions,knowledgeId:record.id,truth:"Only operations actually executed are reported as such. Structured evidence is returned without exposing private chain-of-thought."};
 }
}
