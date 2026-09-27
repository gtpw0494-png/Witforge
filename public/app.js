const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const cookie=name=>document.cookie.split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="))?.slice(name.length+1)||"";
let authState={authenticated:false};
const CHAT_KEY="uai_onechat_id",ACTIVE_TURN_KEY="uai_onechat_active_turn";
let chatId=sessionStorage.getItem(CHAT_KEY)||("chat-"+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)));
sessionStorage.setItem(CHAT_KEY,chatId);
const MAX_ATTACHMENTS=16,UPLOAD_CHUNK_BYTES=1_500_000;
let pendingAttachments=[];
let historyLoadedFor=null;
let activeTurnSession=null;
let activeEventSource=null;
let activeEventSeq=0;

const humanBytes=n=>{n=Number(n||0);if(n<1024)return n+" B";if(n<1024**2)return (n/1024).toFixed(1)+" KB";if(n<1024**3)return (n/1024**2).toFixed(1)+" MB";return (n/1024**3).toFixed(1)+" GB";};
function fileKey(f){return [f.name,f.size,f.lastModified].join(":");}
function attachmentContentUrl(id){return "/api/media/content?id="+encodeURIComponent(String(id||""));}
function resetStream(message="Local-first workspace ready."){
  $("#stream").innerHTML=`<article class="msg system"><b>System</b><p>${esc(message)}</p></article>`;
}
function newChatId(){return "chat-"+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36));}
async function refreshConversations(){
  const list=$("#conversationList");if(!list)return;
  if(!authState.authenticated){list.innerHTML='<p class="muted">Unlock the owner session to load conversations.</p>';return;}
  try{
    const q=$("#conversationSearch")?.value.trim()||"",archived=$("#showArchived")?.checked===true;
    const x=await api("/api/onechat/conversations?q="+encodeURIComponent(q)+"&archived="+String(archived)+"&limit=100");
    const rows=x.conversations||[];
    list.innerHTML=rows.length?rows.map(c=>`<article class="conversation-row ${c.chatId===chatId?"active":""}" data-chat-id="${esc(c.chatId)}"><button type="button" class="conversation-main" data-action="switch"><b>${esc(c.title||c.preview||"Untitled chat")}</b><small>${esc(String(c.turns||0))} turns · ${esc(String(c.attachments||0))} attachments · ${esc(String(c.evidence||0))} evidence</small></button><div class="conversation-actions"><button type="button" data-action="rename">Rename</button><button type="button" data-action="archive">${c.archived?"Unarchive":"Archive"}</button><button type="button" data-action="export">Export</button><button type="button" data-action="delete">Delete</button></div></article>`).join(""):'<p class="muted">No conversations match this view.</p>';
  }catch(e){list.innerHTML=`<p class="muted">Conversation list unavailable: ${esc(e.message)}</p>`;}
}
async function switchConversation(id){
  chatId=String(id);sessionStorage.setItem(CHAT_KEY,chatId);historyLoadedFor=null;resetStream("Loading governed conversation history…");await loadConversationHistory({force:true});await refreshConversations();
}
function turnControls(turnId){
  const id=String(turnId||"");if(!id)return "";
  return `<div class="turn-controls" data-turn-id="${esc(id)}"><button type="button" data-turn-action="edit">Edit</button><button type="button" data-turn-action="retry">Retry</button><button type="button" data-turn-action="regenerate">Regenerate</button><button type="button" data-turn-action="branch">Branch</button><button type="button" data-turn-action="copy">Copy</button><button type="button" data-turn-action="export">Export</button><button type="button" data-turn-action="evidence">Evidence</button></div><div class="turn-evidence" hidden></div>`;
}
async function fetchTurn(id){
  const x=await api("/api/onechat/turn?turnId="+encodeURIComponent(id));
  if(x.state!=="SUCCESS")throw new Error(x.message||"Turn unavailable.");
  return x.turn;
}
function renderLiveProgress(container,event){
  if(!container)return;
  const body=container.querySelector("div")||container;
  let log=body.querySelector(".live-progress");
  if(!log){log=document.createElement("div");log.className="live-progress";body.appendChild(log);}
  if(event.type==="token"){
    let answer=body.querySelector(".live-answer");
    if(!answer){answer=document.createElement("p");answer.className="live-answer";body.insertBefore(answer,log);}
    answer.textContent=String(event.text||"");
  }else if(event.type==="allocations"){
    const names=(event.allocations||[]).map(x=>x.agent).join(" + ");
    log.insertAdjacentHTML("beforeend",`<div><b>Collaborators</b><span>${esc(names||"none")}</span></div>`);
  }else if(event.type==="tool"){
    log.insertAdjacentHTML("beforeend",`<div><b>${esc(event.agent||"tool")}</b><span>${esc(event.state||"UNKNOWN")} · ${esc(event.message||"")}</span></div>`);
  }else if(["phase","model","state","persisted"].includes(event.type)){
    log.insertAdjacentHTML("beforeend",`<div><b>${esc(event.phase||event.type)}</b><span>${esc(event.state||"")} ${esc(event.message||"")}</span></div>`);
  }
  log.scrollTop=log.scrollHeight;
}
function finishLiveTurn(session,wait){
  activeTurnSession=null;activeEventSeq=0;sessionStorage.removeItem(ACTIVE_TURN_KEY);
  if(activeEventSource){activeEventSource.close();activeEventSource=null;}
  $("#stopBtn").hidden=true;$("#sendBtn").hidden=false;$("#sendBtn").disabled=false;$("#attachBtn").disabled=false;
  const x=session?.result||null;
  if(wait?.isConnected)wait.remove();
  if(x){
    const alloc=(x.allocations||[]).map(a=>a.agent).join(" + ");
    bubble(x.state==="SUCCESS"?"assistant":x.state==="PARTIAL"?"partial":x.state==="CANCELLED"?"system":"error","IntraultUniversalion",`<p>${esc(x.message||"No response")}</p>${turnControls(x.knowledgeId)}`,`${esc(x.state||session.state||"UNKNOWN")} · ${esc(x.responseMode||"response")} · ${esc(alloc)}`);
    historyLoadedFor=chatId;refreshConversations();refresh();
  }else if(session?.state==="CANCELLED"){
    bubble("system","Generation stopped","<p>The turn was cancelled. A cancelled result was not persisted as a completed answer.</p>","CANCELLED");
  }else{
    bubble("error","Turn session",`<p>${esc(session?.error||("Turn ended in "+(session?.state||"UNKNOWN")))}</p>`);
  }
}
function connectTurnEvents(sessionId,wait){
  if(activeEventSource)activeEventSource.close();
  const es=new EventSource("/api/onechat/events?id="+encodeURIComponent(sessionId)+"&since="+encodeURIComponent(activeEventSeq));
  activeEventSource=es;
  es.onmessage=e=>{
    let event=null;try{event=JSON.parse(e.data);}catch{return;}
    if(event.seq)activeEventSeq=Math.max(activeEventSeq,event.seq);
    renderLiveProgress(wait,event);
    if(event.type==="done")finishLiveTurn(event.session,wait);
  };
  es.onerror=()=>{
    es.close();
    if(activeTurnSession===sessionId)setTimeout(()=>connectTurnEvents(sessionId,wait),500);
  };
}
async function startLiveTurn(payload,wait){
  const started=await post("/api/onechat/start",payload),session=started.session;
  if(!session?.id)throw new Error("Turn session did not return an ID.");
  activeTurnSession=session.id;activeEventSeq=0;sessionStorage.setItem(ACTIVE_TURN_KEY,session.id);$("#sendBtn").hidden=true;$("#stopBtn").hidden=false;
  connectTurnEvents(session.id,wait);
}
async function recoverActiveTurn(){
  const id=sessionStorage.getItem(ACTIVE_TURN_KEY);if(!id||!authState.authenticated)return;
  try{
    const snap=await api("/api/onechat/session?id="+encodeURIComponent(id)+"&since=0"),session=snap.session;
    if(!session){sessionStorage.removeItem(ACTIVE_TURN_KEY);return;}
    if(["QUEUED","RUNNING","CANCEL_REQUESTED"].includes(session.state)){
      activeTurnSession=id;activeEventSeq=0;$("#sendBtn").hidden=true;$("#stopBtn").hidden=false;
      bubble("working","Recovered live turn","<p>Reconnected to a durable OneChat generation session.</p>");const wait=$("#stream .working:last-child");
      for(const e of snap.events||[]){if(e.seq)activeEventSeq=Math.max(activeEventSeq,e.seq);renderLiveProgress(wait,e);}
      connectTurnEvents(id,wait);return;
    }
    if(session.state==="INTERRUPTED"){
      sessionStorage.removeItem(ACTIVE_TURN_KEY);
      bubble("system","Interrupted generation",`<p>The previous live turn was interrupted by a server/process restart and was not marked completed.</p><button type="button" class="resume-session" data-session-id="${esc(id)}">Resume interrupted turn</button>`,"INTERRUPTED");
      return;
    }
    sessionStorage.removeItem(ACTIVE_TURN_KEY);
  }catch{sessionStorage.removeItem(ACTIVE_TURN_KEY);}
}
async function downloadJson(name,data){
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download=String(name||"uai-export").replace(/[^A-Za-z0-9._-]/g,"_")+".json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function attachmentCards(items=[]){
  if(!items.length)return "";
  return `<div class="history-attachments">${items.map(a=>{
    const label=esc(a.label||a.sourceId||a.id||"attachment"),meta=`${esc(a.modality||"file")} · ${esc(humanBytes(a.bytes||0))}`,src=attachmentContentUrl(a.id);
    let preview="";
    if(a.modality==="image")preview=`<img loading="lazy" src="${src}" alt="${label}">`;
    else if(a.modality==="audio")preview=`<audio controls preload="metadata" src="${src}"></audio>`;
    else if(a.modality==="video")preview=`<video controls preload="metadata" src="${src}"></video>`;
    else preview=`<a class="attachment-open" href="${src}" target="_blank" rel="noopener">Open</a>`;
    return `<article class="history-attachment"><div class="history-preview">${preview}</div><div><b>${label}</b><small>${meta}</small></div></article>`;
  }).join("")}</div>`;
}
async function loadConversationHistory({force=false}={}){
  if(!authState.authenticated)return;
  if(!force&&historyLoadedFor===chatId)return;
  try{
    const h=await api("/api/onechat/history?chatId="+encodeURIComponent(chatId)+"&limit=80");
    const turns=h.turns||[];
    if(!turns.length){resetStream("New local OneChat conversation.");}
    if(turns.length){
      $("#stream").innerHTML='<article class="msg system"><b>System</b><p>Restored governed OneChat history for this local session.</p></article>';
      for(const t of turns){
        bubble("user","You",`<p>${esc(t.user||"")}</p>${attachmentCards(t.attachments||[])}`,t.createdAt||"");
        bubble("assistant","IntraultUniversalion",`<p>${esc(t.answer||"")}</p>${turnControls(t.id)}`,`${esc(t.state||"UNKNOWN")} · ${esc(t.responseMode||"history")}`);
      }
    }
    historyLoadedFor=chatId;
  }catch(e){bubble("error","History",`<p>Conversation history unavailable: ${esc(e.message)}</p>`);}
}
function renderAttachmentTray(){
  const tray=$("#attachmentTray");if(!tray)return;
  tray.hidden=!pendingAttachments.length;
  tray.innerHTML=pendingAttachments.map((x,i)=>`<div class="attachment-chip ${esc(x.state||"ready")}"><div><b>${esc(x.file.name)}</b><small>${esc(humanBytes(x.file.size))} · ${esc(x.file.type||"file")}</small><div class="upload-bar"><span style="width:${Math.max(0,Math.min(100,Number(x.progress||0)))}%"></span></div></div><span class="attachment-state">${esc(x.state||"ready")}</span><button type="button" class="remove-attachment" data-index="${i}" aria-label="Remove attachment">×</button></div>`).join("");
}
function bytesToBase64(buffer){
  const bytes=new Uint8Array(buffer);let binary="",step=0x8000;
  for(let i=0;i<bytes.length;i+=step)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+step,bytes.length)));
  return btoa(binary);
}
async function uploadAttachment(item){
  if(item.mediaId)return item;
  const file=item.file,total=Math.max(1,Math.ceil(file.size/UPLOAD_CHUNK_BYTES));
  if(total>256)throw new Error(`${file.name} exceeds the 400 MB governed media limit.`);
  const uploadId=(globalThis.crypto?.randomUUID?.()||("upload-"+Date.now()+"-"+Math.random().toString(36).slice(2))).replace(/[^A-Za-z0-9_-]/g,"_");
  item.state="uploading";item.progress=0;renderAttachmentTray();
  for(let index=0;index<total;index++){
    const part=file.slice(index*UPLOAD_CHUNK_BYTES,Math.min(file.size,(index+1)*UPLOAD_CHUNK_BYTES));
    const data=bytesToBase64(await part.arrayBuffer());
    const out=await post("/api/media/upload",{uploadId,index,total,name:file.name,mime:file.type||"application/octet-stream",sourceId:"onechat-upload:"+file.name,data});
    item.progress=Math.round(((index+1)/total)*100);item.state=out.state==="PARTIAL"?"uploading":"registered";
    if(out.upload?.mediaId){item.mediaId=out.upload.mediaId;item.artifact=out.artifact||null;item.sha256=out.upload.sha256||null;}
    renderAttachmentTray();
  }
  if(!item.mediaId)throw new Error("Upload completed without a governed media ID.");
  item.state="ready";item.progress=100;renderAttachmentTray();return item;
}

async function api(url,{method="GET",body=null}={}){
  const headers={};
  if(body!==null)headers["content-type"]="application/json";
  const csrf=decodeURIComponent(cookie("uai_csrf")||"");if(method!=="GET"&&csrf)headers["x-uai-csrf"]=csrf;
  const r=await fetch(url,{method,headers,credentials:"same-origin",body:body===null?undefined:JSON.stringify(body)});
  const text=await r.text();let data={};try{data=text?JSON.parse(text):{};}catch{data={state:"ERROR",message:"Invalid server response."};}
  if(!r.ok){const e=new Error(data.message||("HTTP "+r.status));e.status=r.status;e.data=data;throw e;}
  return data;
}
async function post(url,body){return api(url,{method:"POST",body});}
function bubble(kind,title,html,meta=""){const el=document.createElement("article");el.className=`msg ${kind}`;el.innerHTML=`<b>${esc(title)}</b>${meta?`<small>${esc(meta)}</small>`:""}<div>${html}</div>`;$("#stream").appendChild(el);el.scrollIntoView({behavior:"smooth",block:"end"});}
function stateText(states={}){return Object.entries(states).map(([k,v])=>`${k} ${v}`).join(" · ")||"none";}
async function refreshOperations(){
  const el=$("#opsDashboard");if(!el)return;
  if(!authState.authenticated){el.innerHTML='<p class="muted">Unlock the local owner session to inspect governed operations.</p>';return;}
  try{
    const d=await api("/api/control-plane/dashboard"),modelCount=d.models?.models?.length||0,jobRecent=d.scheduler?.recent||[],featureRows=d.evidence?.features||[],auditRecent=d.audit?.recent||[];
    el.innerHTML=`<div class="context-grid">
      <article><b>Tasks</b><span>${d.tasks?.total||0} · ${esc(stateText(d.tasks?.states))}</span></article>
      <article><b>Capabilities</b><span>${d.capabilities?.total||0} · ${esc(stateText(d.capabilities?.availability))}</span></article>
      <article><b>Models</b><span>${modelCount} registered · ${esc(stateText(Object.fromEntries(Object.entries(d.models?.runtimes||{}).map(([k,v])=>[k,v.availability]))))}</span></article>
      <article><b>Plugins</b><span>${d.plugins?.enabled||0}/${d.plugins?.total||0} enabled</span></article>
      <article><b>Approvals</b><span>${d.approvals?.total||0} · ${esc(stateText(d.approvals?.states))}</span></article>
      <article><b>Shadow runs</b><span>${d.shadow?.runs||0} · ${esc(stateText(d.shadow?.states))}</span></article>
      <article><b>Light patches</b><span>${d.light?.patches||0} · ${esc(stateText(d.light?.states))}</span></article>
      <article><b>Worker queue</b><span>${d.scheduler?.queued||0} queued · ${d.scheduler?.running||0} running · max ${d.scheduler?.maxWorkers||0}</span></article>
      <article><b>Private memory</b><span>${d.memory?.active||0} active · ${esc(d.memory?.encryption||"UNKNOWN")}</span></article>
      <article><b>Provenance graph</b><span>${d.provenance?.nodes||0} nodes · ${d.provenance?.edges||0} edges</span></article>
      <article><b>Evaluations</b><span>${d.evaluations?.verified||0}/${d.evaluations?.runs||0} verified</span></article>
      <article><b>Model artifacts</b><span>${d.modelArtifacts?.total||0} · ${esc(stateText(d.modelArtifacts?.states))}</span></article>
      <article><b>Policy simulations</b><span>${d.policySimulations?.total||0} · ${esc(stateText(d.policySimulations?.decisions))}</span></article>
      <article><b>Feature evidence</b><span>${d.evidence?.total||0} · ${esc(stateText(d.evidence?.statuses))}</span></article>
      <article><b>Audit</b><span>${d.audit?.total||0} records · ${esc(d.audit?.integrity?.state||"UNKNOWN")}</span></article>
    </div>
    <details><summary>Recent scheduler jobs</summary><pre>${esc(JSON.stringify(jobRecent,null,2))}</pre></details>
    <details><summary>Feature evidence registry · ${esc(d.generatedFor||"unknown")}</summary><pre>${esc(JSON.stringify(featureRows,null,2))}</pre></details>
    <details><summary>Recent audit records</summary><pre>${esc(JSON.stringify(auditRecent,null,2))}</pre></details>`;
  }catch(e){el.innerHTML=`<p class="muted">Operations dashboard unavailable: ${esc(e.message)}</p>`;}
}

async function refreshAuth(){
  try{
    const s=await api("/api/auth/status");authState=s;
    $("#authTitle").textContent=s.authenticated?"Owner authenticated":s.enrollmentRequired?"Create Owner Account":"Owner sign in";
    $("#authForm").hidden=s.authenticated;$("#logoutBtn").hidden=!s.authenticated;
    $("#authHelp").innerHTML=s.authenticated ? `Signed in as <code>${esc(s.identity?.email||"owner")}</code>. State-changing API calls are locally authorized and audited.` : s.enrollmentRequired ? "Create the one local Owner account. Enrollment closes after successful creation." : "Sign in with the Owner email and password.";
    $("#authSubmit").textContent=s.enrollmentRequired?"Create Owner":"Sign in";
    await refreshOperations();if(s.authenticated){await loadConversationHistory();await refreshConversations();await recoverActiveTurn();}
  }catch(e){$("#authHelp").textContent="Identity status unavailable: "+e.message;}
}
async function refresh(){
  const s=await api("/api/status"),connected=s.capabilities.filter(x=>x.availability==="CONNECTED").length;
  $("#buildLabel").textContent=`v${s.version} · OneChat · local-first governed AI`;
  $("#topTruth").textContent=`${s.governanceKernel?.identity?.authenticated?"owner unlocked":"owner locked"} · ${s.forgelm?.checkpointExists?"ForgeLM ready":"ForgeLM unavailable"} · ${connected}/${s.capabilities.length} capabilities`;
  $("#systemContext").innerHTML=`<article><b>Version</b><span>${esc(s.version)}</span></article><article><b>Knowledge</b><span>${s.knowledgeCount}</span></article><article><b>Documents</b><span>${s.documentDataPlane?.documents||0}</span></article><article><b>Definitions</b><span>${s.languageData?.definitions||0}</span></article><article><b>Dialogue</b><span>${s.languageData?.dialogueMessages||0}</span></article><article><b>Agents</b><span>${s.agentCount}</span></article><article><b>Shadow R&D</b><span>${s.shadow?.runs||0} runs · ${s.shadow?.active||0} active</span></article><article><b>Light patches</b><span>${s.light?.patches||0} patches · ${s.light?.active||0} active</span></article><article><b>Governance stop</b><span>${s.governanceKernel?.emergencyStop?.engaged?"ENGAGED":"ready"}</span></article><article><b>Source refs</b><span>${s.sourceResearch?.count||0}</span></article><article><b>ForgeLM</b><span>${esc(s.forgelm?.state||"UNKNOWN")}</span></article><article><b>Audit</b><span>${s.auditCount}</span></article>`;
  const deps=s.neuralDependencies?.dependencies||{};$("#depSummary").innerHTML=`<p class="muted">Neural dependencies: ${Object.entries(deps).map(([k,v])=>`${esc(k)}=${esc(v)}`).join(" · ")}</p>`;
  $("#doctrine").innerHTML=`<ol>${s.doctrine.laws.map(x=>`<li>${esc(x)}</li>`).join("")}</ol><p>${esc(s.doctrine.governance.truthRule)}</p><div class="caps">${s.capabilities.map(c=>`<span class="cap ${c.availability.toLowerCase()}">${esc(c.id)} · ${esc(c.availability)}</span>`).join("")}</div>`;
  if(authState.authenticated)refreshOperations();
}

$("#authForm").addEventListener("submit",async e=>{
  e.preventDefault();const email=$("#ownerEmail").value.trim(),password=$("#ownerPassword").value;if(!email||!password)return;
  try{const endpoint=authState.enrollmentRequired?"/api/auth/enroll":"/api/auth/login";await post(endpoint,{email,password});$("#ownerPassword").value="";await refreshAuth();await refresh();bubble("system","Security","<p>Owner session authenticated. The password is not stored in browser storage.</p>");}
  catch(err){bubble("error","Authentication",`<p>${esc(err.message)}</p>`);}
});
$("#logoutBtn").addEventListener("click",async()=>{
  try{await post("/api/auth/logout",{});await refreshAuth();await refresh();bubble("system","Security","<p>Local owner session locked.</p>");}catch(err){bubble("error","Authentication",`<p>${esc(err.message)}</p>`);}
});
$("#newChatBtn").addEventListener("click",async()=>{
  chatId=newChatId();sessionStorage.setItem(CHAT_KEY,chatId);historyLoadedFor=null;pendingAttachments=[];renderAttachmentTray();resetStream("New local OneChat conversation.");await refreshConversations();$("#chatIn").focus();
});
$("#conversationSearch").addEventListener("input",()=>refreshConversations());
$("#showArchived").addEventListener("change",()=>refreshConversations());
$("#conversationList").addEventListener("click",async e=>{
  const btn=e.target.closest("button[data-action]");if(!btn)return;
  const row=btn.closest(".conversation-row"),id=row?.dataset.chatId;if(!id)return;
  const action=btn.dataset.action;
  try{
    if(action==="switch")return await switchConversation(id);
    if(action==="rename"){const title=prompt("Conversation name:","");if(title!==null)await post("/api/onechat/conversation",{chatId:id,title:title.trim()});}
    if(action==="archive")await post("/api/onechat/conversation",{chatId:id,archived:btn.textContent.trim()==="Archive"});
    if(action==="export"){
      const data=await api("/api/onechat/export?chatId="+encodeURIComponent(id));
      const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),a=document.createElement("a");
      a.href=URL.createObjectURL(blob);a.download=(data.title||id).replace(/[^A-Za-z0-9._-]/g,"_")+".json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    }
    if(action==="delete"){
      if(!confirm("Delete this conversation's local chat records? Registered media artifacts are retained."))return;
      await post("/api/onechat/delete",{chatId:id});
      if(id===chatId){chatId=newChatId();sessionStorage.setItem(CHAT_KEY,chatId);historyLoadedFor=null;resetStream("Conversation deleted. Started a new local chat.");}
    }
    await refreshConversations();
  }catch(err){bubble("error","Conversation",`<p>${esc(err.message)}</p>`);}
});
$("#stream").addEventListener("click",async e=>{
  const resume=e.target.closest(".resume-session");
  if(resume){
    try{
      const out=await post("/api/onechat/resume",{id:resume.dataset.sessionId});
      const session=out.session;if(!session?.id)throw new Error("Resume did not return a new session.");
      activeTurnSession=session.id;activeEventSeq=0;sessionStorage.setItem(ACTIVE_TURN_KEY,session.id);
      $("#sendBtn").hidden=true;$("#stopBtn").hidden=false;
      bubble("working","Resumed turn","<p>Restarted the interrupted turn as a new governed session.</p>");const wait=$("#stream .working:last-child");
      connectTurnEvents(session.id,wait);resume.disabled=true;
    }catch(err){bubble("error","Resume generation",`<p>${esc(err.message)}</p>`);}
    return;
  }
  const btn=e.target.closest("button[data-turn-action]");if(!btn)return;
  const controls=btn.closest(".turn-controls"),turnId=controls?.dataset.turnId;if(!turnId)return;
  const action=btn.dataset.turnAction;
  try{
    if(action==="copy"){
      const t=await fetchTurn(turnId);await navigator.clipboard.writeText(t.answer||"");btn.textContent="Copied";setTimeout(()=>btn.textContent="Copy",1200);return;
    }
    if(action==="export"){
      const data=await api("/api/onechat/turn-export?turnId="+encodeURIComponent(turnId));await downloadJson("uai-turn-"+turnId,data);return;
    }
    if(action==="evidence"){
      const panel=controls.parentElement.querySelector(".turn-evidence");if(!panel)return;
      if(!panel.hidden){panel.hidden=true;return;}
      const t=await fetchTurn(turnId),evidence=t.evidenceEnvelope||{message:"No structured evidence envelope stored for this turn."};
      panel.innerHTML=`<pre>${esc(JSON.stringify(evidence,null,2))}</pre>`;panel.hidden=false;return;
    }
    if(action==="branch"){
      const b=await post("/api/onechat/branch",{turnId,includeTurn:true});await switchConversation(b.chatId);return;
    }
    if(action==="edit"){
      const t=await fetchTurn(turnId),edited=prompt("Edit this message and create a branch:",t.user||"");
      if(edited===null||!edited.trim())return;
      const out=await post("/api/onechat/retry",{turnId,message:edited.trim()});chatId=out.chatId;sessionStorage.setItem(CHAT_KEY,chatId);historyLoadedFor=null;await loadConversationHistory({force:true});await refreshConversations();return;
    }
    if(action==="retry"||action==="regenerate"){
      const out=await post("/api/onechat/retry",{turnId});chatId=out.chatId;sessionStorage.setItem(CHAT_KEY,chatId);historyLoadedFor=null;await loadConversationHistory({force:true});await refreshConversations();return;
    }
  }catch(err){bubble("error","Turn control",`<p>${esc(err.message)}</p>`);}
});
$("#stopBtn").addEventListener("click",async()=>{
  if(!activeTurnSession)return;
  const id=activeTurnSession;$("#stopBtn").disabled=true;
  try{await post("/api/onechat/stop",{id});}
  catch(err){bubble("error","Stop generation",`<p>${esc(err.message)}</p>`);}
  finally{$("#stopBtn").disabled=false;}
});
$("#attachBtn").addEventListener("click",()=>$("#filePicker").click());
$("#filePicker").addEventListener("change",e=>{
  const files=[...e.target.files||[]];
  for(const file of files){
    if(pendingAttachments.length>=MAX_ATTACHMENTS)break;
    if(!pendingAttachments.some(x=>fileKey(x.file)===fileKey(file)))pendingAttachments.push({file,state:"ready",progress:0,mediaId:null});
  }
  e.target.value="";renderAttachmentTray();
});
$("#attachmentTray").addEventListener("click",e=>{
  const btn=e.target.closest(".remove-attachment");if(!btn)return;
  const i=Number(btn.dataset.index);if(Number.isInteger(i))pendingAttachments.splice(i,1);renderAttachmentTray();
});
$("#composer").addEventListener("submit",async e=>{
  e.preventDefault();const input=$("#chatIn"),text=input.value.trim(),send=$("#sendBtn"),attach=$("#attachBtn");if((!text&&!pendingAttachments.length)||activeTurnSession)return;
  send.disabled=true;attach.disabled=true;
  const shownText=text||"Analyse the attached evidence.";
  const names=pendingAttachments.map(x=>`<span class="inline-file">${esc(x.file.name)}</span>`).join(" ");
  bubble("user","You",`<p>${esc(shownText)}</p>${names?`<div class="inline-files">${names}</div>`:""}`);
  bubble("working","System","<p>Securing attachments and starting governed turn execution…</p>");const wait=$("#stream .working:last-child");
  try{
    const uploaded=[];
    for(const item of pendingAttachments){await uploadAttachment(item);uploaded.push({mediaId:item.mediaId,label:item.file.name,sourceId:item.artifact?.sourceId||("onechat-upload:"+item.file.name)});}
    await startLiveTurn({message:shownText,chatId,attachments:uploaded},wait);
    input.value="";pendingAttachments=[];renderAttachmentTray();
  }catch(err){
    wait.remove();if(err.status===401){await refreshAuth();bubble("error","Authentication","<p>Unlock the local owner session before using OneChat actions.</p>");}
    else if(err.status===409&&err.data?.binding){bubble("error","Approval required",`<p>${esc(err.message)}</p><pre>${esc(JSON.stringify(err.data.binding,null,2))}</pre>`);}
    else bubble("error","Error",`<p>${esc(err.message)}</p>`);
  }finally{if(!activeTurnSession){send.disabled=false;attach.disabled=false;}}
});
Promise.all([refresh(),refreshAuth()]);
