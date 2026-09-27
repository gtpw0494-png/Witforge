import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KnowledgeStore } from "./src/store.js";
import { ResearchAgent, DevelopmentAgent, ExplorativeAgent } from "./src/agents.js";
import { buildCapabilityRegistry } from "./src/capabilities.js";
import { ProviderHub } from "./src/providers.js";
import { KnowledgeEngine } from "./src/knowledge.js";
import { AgentRegistry, TaskEngine } from "./src/agent-system.js";
import { ControlCenter } from "./src/control-center.js";
import { OneChatRouter } from "./src/onechat.js";
import { OneChatTurnSessions } from "./src/onechat-turn-sessions.js";
import { ForgeLMBridge } from "./src/forgelm-bridge.js";
import { LocalCapabilityRouter } from "./src/local-capability-router.js";
import { ForgeLocalOrchestrator } from "./src/local-capability-orchestrator.js";
import { LearningFabric } from "./src/learning-fabric.js";
import { dependencyStatus } from "./src/dependency-status.js";
import { SelfDevelopmentEngine } from "./src/self-development.js";
import { ModelLab } from "./src/model-lab.js";
import { verifyRelease } from "./src/release-integrity.js";
import { exportKnowledgeRecord, importKnowledgeRecord } from "./src/transport.js";
import { THREE_LAWS, GOVERNANCE } from "./src/doctrine.js";
import { AuditLog } from "./src/audit.js";
import { WorkspaceManager } from "./src/workspace.js";
import { WebCorpus } from "./src/web-corpus.js";
import { RuntimeServices } from "./src/runtime-services.js";
import { LangGraphAdapter } from "./src/langgraph-adapter.js";
import { StorageDatabase } from "./src/storage-db.js";
import { TaskStore } from "./src/task-store.js";
import { ActionEnvelopeStore } from "./src/action-envelope.js";
import { AvailabilityLedger } from "./src/availability-ledger.js";
import { PolicyEngine } from "./src/policy-engine.js";
import { ApprovalStore } from "./src/approval-store.js";
import { AutonomyStore } from "./src/autonomy-store.js";
import { PluginRegistry } from "./src/plugin-registry.js";
import { ModelRegistry } from "./src/model-registry.js";
import { PluginExecutor } from "./src/plugin-executor.js";
import { LlamaCppRuntime } from "./src/model-runtime-adapter.js";
import { Observability } from "./src/observability.js";
import { IdempotencyStore } from "./src/idempotency-store.js";
import { PluginGateway } from "./src/plugin-gateway.js";
import { DocumentStore } from "./src/document-store.js";
import { LocalIdentity, sessionCookies, clearSessionCookies } from "./src/governance/identity.js";
import { RequestAuthorizer } from "./src/governance/authorization.js";
import { GovernanceKernel } from "./src/governance/kernel.js";
import { ConversationEngine } from "./src/conversation-engine.js";
import { ModelRouter, buildLocalModelCandidates, buildProviderModelCandidates } from "./src/models/router.js";
import { WebResearchEngine } from "./src/web-research-engine.js";
import { ShadowCoordinator } from "./src/shadow/shadow-coordinator.js";
import { LightCoordinator } from "./src/light/light-coordinator.js";
import { BoundedWorkerScheduler } from "./src/control-plane-scheduler.js";
import { platformCapabilityCatalog } from "./src/platform-capability-catalog.js";
import { MemoryStore } from "./src/memory/memory-store.js";
import { ProvenanceGraph } from "./src/provenance/graph.js";
import { PolicySimulator } from "./src/governance/policy-simulator.js";
import { ModelArtifactVerifier } from "./src/models/artifact-verifier.js";
import { EvaluationStore } from "./src/evaluation/evaluation-store.js";
import { VerifiedKnowledgeStore } from "./src/verified-knowledge-store.js";
import { CloudKnowledgeStore } from "./src/cloud-knowledge-store.js";
import { HybridKnowledgeStore } from "./src/hybrid-knowledge-store.js";
import { KnowledgeTraining } from "./src/knowledge-training.js";
import { KnowledgeTrainingJob } from "./src/knowledge-training-job.js";
import { KnowledgeJobStore } from "./src/knowledge-job-store.js";
import { ForgeLMCandidatePromotion } from "./src/forgelm-candidate-promotion.js";
import { ForgeVisionCandidatePromotion } from "./src/forgevision-candidate-promotion.js";
import { ForgeAudioCandidatePromotion } from "./src/forgeaudio-candidate-promotion.js";
import { ForgeSpeechCandidatePromotion } from "./src/forgespeech-candidate-promotion.js";
import { ForgeVideoCandidatePromotion } from "./src/forgevideo-candidate-promotion.js";
import { KnowledgeLearningPipeline } from "./src/knowledge-learning-pipeline.js";
import { KnowledgeAutonomy } from "./src/knowledge-autonomy.js";
import { KnowledgeResearchWorker } from "./src/knowledge-research-worker.js";
import { KnowledgeScheduler } from "./src/knowledge-scheduler.js";
import { MultimodalPipeline } from "./src/multimodal/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageMeta = JSON.parse(fs.readFileSync(path.join(__dirname,"package.json"),"utf8"));
const APP_VERSION = packageMeta.version || "UNKNOWN";
const stateDir = process.env.IUV_STATE_DIR ? path.resolve(process.env.IUV_STATE_DIR) : path.join(__dirname, "state");
const store = new KnowledgeStore(path.join(__dirname, "data"));
const audit = new AuditLog(stateDir);
const workspace = new WorkspaceManager(__dirname, stateDir, audit);
const providerHub = new ProviderHub(audit);
const knowledge = new KnowledgeEngine(store);
const research = new ResearchAgent(store, knowledge);
const development = new DevelopmentAgent(store, workspace);
const explorative = new ExplorativeAgent(store, knowledge);
const agents = new AgentRegistry(stateDir, audit);
const taskStore = new TaskStore(stateDir, audit);
const actionEnvelopes = new ActionEnvelopeStore(stateDir, audit);
const availabilityLedger = new AvailabilityLedger(stateDir);
const policyEngine = new PolicyEngine();
const approvalStore = new ApprovalStore(stateDir,audit);
const autonomyStore = new AutonomyStore(stateDir,audit);
const identity = new LocalIdentity(stateDir,audit);
const ownerBootstrap = identity.bootstrapFromEnvironment();
delete process.env.UAI_OWNER_PASSWORD;
delete process.env.UAI_OWNER_TOKEN;
delete process.env.IUV_OWNER_TOKEN;
if(ownerBootstrap.state==="BLOCKED")throw new Error(ownerBootstrap.message||"Owner bootstrap configuration is invalid.");
const requestAuthorizer = new RequestAuthorizer({identity,policyEngine,approvalStore,audit,appVersion:APP_VERSION});
const governanceKernel = new GovernanceKernel({identity,authorizer:requestAuthorizer,policyEngine,approvalStore,autonomyStore,audit,stateRoot:stateDir});
const pluginRegistry = new PluginRegistry(stateDir,audit);
const idempotencyStore = new IdempotencyStore(stateDir,audit);
const modelRegistry = new ModelRegistry();
const llamaRuntime = new LlamaCppRuntime();
const observability = new Observability(audit);
const pluginExecutor = new PluginExecutor({registry:pluginRegistry,approvalStore,policyEngine,idempotencyStore,audit});
const tasks = new TaskEngine({store,knowledge,providers:providerHub,research,development,explorative,agents,audit,taskStore,actionEnvelopes,policyEngine,approvalStore});
const control = new ControlCenter(stateDir, audit);
const forgelm = new ForgeLMBridge();
const localCapabilityRouter = new LocalCapabilityRouter();
const localOrchestrator = new ForgeLocalOrchestrator({ router: localCapabilityRouter });
const externalModelRouting=String(process.env.IUV_ENABLE_EXTERNAL_MODEL_ROUTING||"").toLowerCase()==="true";
const modelRouter = new ModelRouter({candidates:[...buildLocalModelCandidates({llamaRuntime,forgelm}),...(externalModelRouting?buildProviderModelCandidates(providerHub):[])],audit});
const conversation = new ConversationEngine({llamaRuntime,forgelm,modelRouter,store,audit});
const learning = new LearningFabric({store,audit,root:__dirname});
const selfdev = new SelfDevelopmentEngine({root:__dirname,stateRoot:stateDir,store,workspace,audit});
const forgeLMCandidatePromotion = new ForgeLMCandidatePromotion({root:__dirname,stateRoot:stateDir,audit});
const forgeVisionCandidatePromotion = new ForgeVisionCandidatePromotion({root:__dirname,stateRoot:stateDir,audit});
const forgeAudioCandidatePromotion = new ForgeAudioCandidatePromotion({root:__dirname,stateRoot:stateDir,audit});
const forgeSpeechCandidatePromotion = new ForgeSpeechCandidatePromotion({root:__dirname,stateRoot:stateDir,audit});
const forgeVideoCandidatePromotion = new ForgeVideoCandidatePromotion({root:__dirname,stateRoot:stateDir,audit});
const modelLab = new ModelLab({learning,audit,stateRoot:stateDir,candidatePromotion:forgeLMCandidatePromotion});
const documentStore = new DocumentStore();
const webCorpus = new WebCorpus({root:__dirname,store,audit,documentStore});
const webResearch = new WebResearchEngine({audit});
const runtimeServices = new RuntimeServices();
const langgraph = new LangGraphAdapter();
const storageDb = new StorageDatabase();
const memoryStore = new MemoryStore({stateRoot:stateDir,audit});
const provenanceGraph = new ProvenanceGraph({stateRoot:stateDir,audit,memoryStore});
const multimodalPipeline = new MultimodalPipeline({stateRoot:stateDir,audit,provenanceGraph,allowedRoots:[path.join(stateDir,"media-input"),path.join(__dirname,"model","data"),path.join(__dirname,"data")]});
const policySimulator = new PolicySimulator({policyEngine,stateRoot:stateDir,audit});
const modelArtifactVerifier = new ModelArtifactVerifier({stateRoot:stateDir,audit});
const evaluationStore = new EvaluationStore({stateRoot:stateDir,audit});
const verifiedKnowledgeLocal = new VerifiedKnowledgeStore({stateRoot:stateDir});
const verifiedKnowledgeCloud = new CloudKnowledgeStore();
const verifiedKnowledgeStore = new HybridKnowledgeStore({local:verifiedKnowledgeLocal,cloud:verifiedKnowledgeCloud,audit});
const knowledgeTraining = new KnowledgeTraining({store:verifiedKnowledgeStore});
const knowledgeTrainingJob = new KnowledgeTrainingJob({root:__dirname,stateRoot:stateDir});
const knowledgeJobStore = new KnowledgeJobStore({stateRoot:stateDir});
const knowledgeLearningPipeline = new KnowledgeLearningPipeline({trainingJob:knowledgeTrainingJob,promotion:forgeLMCandidatePromotion,jobStore:knowledgeJobStore,audit});
const autonomousKnowledgeSources = JSON.parse(fs.readFileSync(path.join(__dirname,"model","knowledge_sources.json"),"utf8")).sources;
const autonomousKnowledge = new KnowledgeAutonomy({registry:autonomousKnowledgeSources});
const knowledgeResearchWorker = new KnowledgeResearchWorker({webResearch,webCorpus,sources:autonomousKnowledgeSources,audit});
const knowledgeResearchScheduler = new KnowledgeScheduler({
  stateRoot:stateDir,
  runner:(topic)=>knowledgeResearchWorker.researchTopic(topic,{perSource:Number(process.env.IUV_KNOWLEDGE_PER_SOURCE||2),maxSources:Number(process.env.IUV_KNOWLEDGE_MAX_SOURCES||12)})
});
if(String(process.env.IUV_KNOWLEDGE_TOPICS||"").trim()){
  knowledgeResearchScheduler.configure({topics:String(process.env.IUV_KNOWLEDGE_TOPICS).split(",")});
}
if(knowledgeResearchScheduler.status().enabled||String(process.env.IUV_KNOWLEDGE_AUTOSTART||"").toLowerCase()==="true"){
  knowledgeResearchScheduler.start();
}
const agentScheduler = new BoundedWorkerScheduler({
  stateRoot:stateDir,
  audit,
  maxWorkers:Number(process.env.IUV_AGENT_WORKERS||4),
  maxQueue:Number(process.env.IUV_AGENT_QUEUE||128),
  leaseMs:Number(process.env.IUV_AGENT_LEASE_MS||60000)
});
const shadow = new ShadowCoordinator({stateRoot:stateDir,audit,maxWorkers:Number(process.env.IUV_SHADOW_WORKERS||4),scheduler:agentScheduler});
const light = new LightCoordinator({root:__dirname,stateRoot:stateDir,audit,maxWorkers:Number(process.env.IUV_LIGHT_WORKERS||2),scheduler:agentScheduler});
const platformCatalog = platformCapabilityCatalog();
const featureEvidence = JSON.parse(fs.readFileSync(path.join(__dirname,"governance","feature-evidence.json"),"utf8"));
const sourceRegistry = JSON.parse(fs.readFileSync(path.join(__dirname,"research","source_registry.json"),"utf8")).sources;
const countBy=(rows,key="state")=>Object.fromEntries(Object.entries((rows||[]).reduce((acc,row)=>{const k=String(row?.[key]||"UNKNOWN");acc[k]=(acc[k]||0)+1;return acc;},{})).sort(([a],[b])=>a.localeCompare(b)));
const capabilitySnapshot=async()=>{const deps=dependencyStatus(),model=await forgelm.status(),vision=await forgelm.visionStatus(),audio=await forgelm.audioStatus(),speech=await forgelm.speechStatus(),video=await forgelm.videoStatus(),multimodal=await forgelm.multimodalStatus(),lg=await langgraph.status();return buildCapabilityRegistry(providerHub,{deps,model,vision,audio,speech,video,multimodal,langgraph:lg,runtimes:{llamacpp:await llamaRuntime.status()},local:await localOrchestrator.promotionSnapshot()});};
const pluginGateway = new PluginGateway({registry:pluginRegistry,policyEngine,approvalStore,autonomyStore,idempotencyStore,capabilityStatus:capabilitySnapshot,audit});
const onechat = new OneChatRouter({research,development,explorative,tasks,knowledge,agents,store,audit,forgelm,conversation,learning,selfdev,control,sourceRegistry,dependencyStatus,modelLab,webCorpus,webResearch,documentStore,multimodalPipeline,runtimeServices,langgraph,storageDb,policyEngine,policySimulator,memoryStore,provenanceGraph,evaluationStore,modelArtifactVerifier,approvalStore,autonomyStore,pluginRegistry,modelRegistry,llamaRuntime,observability,localOrchestrator,localCapabilityRouter,modelRouter,taskStore,availabilityLedger,providerHub,capabilityStatus:capabilitySnapshot,availabilityStatus:async()=>availabilityLedger.record(await capabilitySnapshot())});
const onechatTurnSessions = new OneChatTurnSessions({onechat,audit,stateRoot:stateDir});
const PORT = Number(process.env.PORT || 8787);
const HOST = String(process.env.HOST || "127.0.0.1").trim() || "127.0.0.1";

const MAX_RESPONSE_BYTES=Math.max(65536,Math.min(16_000_000,Number(process.env.IUV_MAX_RESPONSE_BYTES||4_000_000)));
function send(res,status,data,type="application/json"){
  const payload=type==="application/json"?JSON.stringify(data,null,2):data;
  const bytes=Buffer.byteLength(payload);
  if(type==="application/json"&&bytes>MAX_RESPONSE_BYTES){
    const small=JSON.stringify({state:"BLOCKED",message:"Response exceeded the configured API size limit.",maxBytes:MAX_RESPONSE_BYTES,requestId:res.getHeader("x-request-id")||null},null,2);
    res.writeHead(413,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});return res.end(small);
  }
  res.writeHead(status,{"content-type":`${type}; charset=utf-8`,"cache-control":"no-store"});res.end(payload);
}
function sha256FileSync(file){
  const h=crypto.createHash("sha256"),fd=fs.openSync(file,"r"),buf=Buffer.allocUnsafe(1024*1024);
  try{let n=0;do{n=fs.readSync(fd,buf,0,buf.length,null);if(n)h.update(buf.subarray(0,n));}while(n);}finally{fs.closeSync(fd);}
  return h.digest("hex");
}
function readBody(req){
  if(req._uaiBodyPromise)return req._uaiBodyPromise;
  req._uaiBodyPromise=new Promise((resolve,reject)=>{let d="";req.on("data",chunk=>{d+=chunk;if(d.length>4_000_000){const e=new Error("Request body exceeds 4 MB limit.");e.statusCode=400;reject(e);}});req.on("end",()=>resolve(JSON.parse(d||"{}")));req.on("error",reject);});
  return req._uaiBodyPromise;
}
function allowedOrigin(req){
  const origin=String(req.headers.origin||"").trim();
  if(!origin)return true;
  const allowed=new Set([`http://127.0.0.1:${PORT}`,`http://localhost:${PORT}`,...String(process.env.IUV_ALLOWED_ORIGINS||"").split(",").map(x=>x.trim()).filter(Boolean)]);
  return allowed.has(origin);
}
const loginBuckets=new Map();
function allowLoginAttempt(req){
  const now=Date.now(),window=Math.floor(now/60000),remote=String(req.socket.remoteAddress||"local"),key=remote+"|"+window;
  const count=(loginBuckets.get(key)||0)+1;loginBuckets.set(key,count);
  if(loginBuckets.size>1000)for(const k of loginBuckets.keys())if(!k.endsWith("|"+window))loginBuckets.delete(k);
  return {allowed:count<=10,count,limit:10,resetAt:new Date((window+1)*60000).toISOString()};
}
function setSecurityHeaders(res,requestId,correlationId){
  res.setHeader("x-request-id",requestId);res.setHeader("x-correlation-id",correlationId);
  res.setHeader("x-content-type-options","nosniff");res.setHeader("referrer-policy","no-referrer");res.setHeader("x-frame-options","DENY");
  res.setHeader("content-security-policy","default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader("permissions-policy","camera=(), microphone=(), geolocation=()");
}

const server=http.createServer(async(req,res)=>{try{
  const requestId=/^[A-Za-z0-9._:-]{1,128}$/.test(String(req.headers["x-request-id"]||""))?String(req.headers["x-request-id"]):`req-${crypto.randomUUID()}`;
  const correlationId=/^[A-Za-z0-9._:-]{1,128}$/.test(String(req.headers["x-correlation-id"]||""))?String(req.headers["x-correlation-id"]):requestId;
  setSecurityHeaders(res,requestId,correlationId);
  const url=new URL(req.url,`http://${req.headers.host}`);
  if(url.pathname.startsWith("/api/")&&!allowedOrigin(req)){
    audit.append({type:"api.denied",requestId,correlationId,reason:"origin",method:req.method,path:url.pathname});
    return send(res,403,{state:"BLOCKED",message:"Cross-origin API request is not allowed.",requestId,correlationId});
  }
  if(url.pathname.startsWith("/api/")&&req.headers.origin){
    res.setHeader("access-control-allow-origin",String(req.headers.origin));res.setHeader("vary","Origin");res.setHeader("access-control-allow-credentials","true");
  }
  if(url.pathname.startsWith("/api/")&&req.method==="OPTIONS"){
    res.setHeader("access-control-allow-methods","GET,POST,OPTIONS");res.setHeader("access-control-allow-headers","content-type,x-uai-csrf,x-uai-approval-id,x-request-id,x-correlation-id,idempotency-key");
    return send(res,204,"","text/plain");
  }
  if(req.method==="GET"&&url.pathname==="/api/auth/status"){
    const auth=identity.authenticateRequest(req);return send(res,200,{...identity.status(auth),governance:governanceKernel.status(auth),requestId,correlationId});
  }
  if(req.method==="POST"&&url.pathname==="/api/auth/enroll"){
    const b=await readBody(req),loginRate=allowLoginAttempt(req);
    if(!loginRate.allowed)return send(res,429,{state:"BLOCKED",message:"Too many owner enrollment attempts.",rate:loginRate,requestId,correlationId});
    const out=identity.enroll(b.email,b.password);
    if(out.state!=="SUCCESS")return send(res,out.state==="DENIED"?409:400,{...out,requestId,correlationId});
    const login=identity.login(b.email,b.password);res.setHeader("set-cookie",sessionCookies(login,{secure:Boolean(req.socket.encrypted)}));
    const {sessionToken,...safe}=login;return send(res,201,{...safe,enrollment:"COMPLETE",requestId,correlationId});
  }
  if(req.method==="POST"&&url.pathname==="/api/auth/login"){
    const b=await readBody(req),loginRate=allowLoginAttempt(req);
    if(!loginRate.allowed)return send(res,429,{state:"BLOCKED",message:"Too many owner login attempts.",rate:loginRate,requestId,correlationId});
    const loginGate=requestAuthorizer.authorize({req,url,body:b,requestId,correlationId});
    if(!loginGate.allowed)return send(res,loginGate.httpStatus||400,{state:loginGate.state,message:loginGate.message,validation:loginGate.validation||null,requestId,correlationId});
    const login=identity.login(b.email,b.password);
    if(login.state!=="SUCCESS"){audit.append({type:"identity.login.denied",requestId,correlationId,remote:String(req.socket.remoteAddress||"")});return send(res,401,{state:login.state,message:login.message,requestId,correlationId});}
    res.setHeader("set-cookie",sessionCookies(login,{secure:Boolean(req.socket.encrypted)}));
    const {sessionToken,...safe}=login;return send(res,200,{...safe,requestId,correlationId});
  }
  if(url.pathname.startsWith("/api/")){
    const body=["GET","HEAD","OPTIONS"].includes(req.method)?{}:await readBody(req);
    const gate=requestAuthorizer.authorize({req,url,body,requestId,correlationId});
    if(!gate.allowed){
      audit.append({type:"api.denied",requestId,correlationId,actor:gate.auth?.identityId||null,method:req.method,path:url.pathname,state:gate.state,reason:gate.message,capability:gate.meta?.capability||null});
      return send(res,gate.httpStatus||403,{state:gate.state,message:gate.message,policy:gate.policy||null,binding:gate.binding||null,validation:gate.validation||null,rate:gate.rate||null,requestId,correlationId});
    }
    req.uaiSecurity=gate;
    const stop=governanceKernel.emergencyStop.status();
    const emergencyExempt=new Set(["/api/governance/emergency/release","/api/approvals/request","/api/approvals/decide"]);
    if(stop.engaged&&gate.meta?.stateChanging&&!emergencyExempt.has(url.pathname)){
      audit.append({type:"api.denied",requestId,correlationId,actor:gate.auth?.identityId||null,method:req.method,path:url.pathname,state:"BLOCKED",reason:"emergency-stop"});
      return send(res,423,{state:"BLOCKED",message:"Governance emergency stop is engaged.",emergencyStop:stop,requestId,correlationId});
    }
    if(req.method==="POST"&&url.pathname==="/api/auth/logout"){
      const out=identity.logout(req);res.setHeader("set-cookie",clearSessionCookies({secure:Boolean(req.socket.encrypted)}));return send(res,200,{...out,requestId,correlationId});
    }
  }

  if(req.method==="GET"&&url.pathname==="/api/local/status")return send(res,200,await localOrchestrator.promotionSnapshot());
  if(req.method==="POST"&&url.pathname==="/api/local/chat"){
    const b=await readBody(req);
    const result=await localOrchestrator.chat(b.prompt || b.message || "", b.context || "");
    return send(res,200,result);
  }
  if(req.method==="POST"&&url.pathname==="/api/local/code"){
    const b=await readBody(req);
    const result=await localOrchestrator.code(b.prompt || b.message || "", b.context || "");
    return send(res,200,result);
  }
  if(req.method==="POST"&&url.pathname==="/api/local/reason"){
    const b=await readBody(req);
    const result=await localOrchestrator.reason(b.problem || b.prompt || b.message || "", b.context || "");
    return send(res,200,result);
  }
  if(req.method==="POST"&&url.pathname==="/api/local/structured"){
    const b=await readBody(req);
    const result=await localOrchestrator.structured(b.payload || b.text || b.prompt || b.message || "{}", b.context || "");
    return send(res,200,result);
  }

  if(req.method==="GET"&&url.pathname==="/api/knowledge/research/status"){
    return send(res,200,knowledgeResearchScheduler.status());
  }
  if(req.method==="POST"&&url.pathname==="/api/knowledge/research/run"){
    const b=await readBody(req);
    const out=await knowledgeResearchScheduler.runOnce(String(b.topic||""));
    return send(res,["SUCCESS","PARTIAL"].includes(out.state)?200:409,out);
  }
  if(req.method==="POST"&&url.pathname==="/api/knowledge/research/schedule"){
    const b=await readBody(req);
    knowledgeResearchScheduler.configure({topics:b.topics,intervalMs:b.intervalMs,enabled:b.enabled});
    const out=b.enabled===true?knowledgeResearchScheduler.start():b.enabled===false?knowledgeResearchScheduler.stop():knowledgeResearchScheduler.status();
    audit.append({type:"knowledge.research.schedule",requestId,correlationId,actor:req.uaiSecurity?.auth?.identityId||null,enabled:out.enabled,intervalMs:out.intervalMs,topics:out.topics});
    return send(res,200,out);
  }

  if(req.method==="GET"&&url.pathname==="/api/knowledge/autonomy/status"){
    return send(res,200,{...autonomousKnowledge.status(),store:verifiedKnowledgeStore.snapshot()});
  }
  if(req.method==="GET"&&url.pathname==="/api/knowledge/autonomy/sources"){
    return send(res,200,{state:"SUCCESS",sources:autonomousKnowledgeSources.map(({id,name,domain,type,allowed,license,trust,priority})=>({id,name,domain,type,allowed,license,trust,priority}))});
  }
  if(req.method==="POST"&&url.pathname==="/api/knowledge/autonomy/verify-ingest"){
    const b=await readBody(req);
    const verification=autonomousKnowledge.verifyFacts(b.items||[]);
    const persisted=await verifiedKnowledgeStore.upsertMany(verification.facts||[]);
    audit.append({type:"knowledge.autonomy.ingest",requestId,correlationId,actor:req.uaiSecurity?.auth?.identityId||null,candidates:verification.total_candidates||0,verified:verification.verified||0,local:persisted.local||null,cloud:persisted.cloud?.state||null});
    return send(res,200,{state:"SUCCESS",verification,persisted});
  }

  if(req.method==="GET"&&url.pathname==="/api/knowledge/store/status"){
    return send(res,200,{state:"SUCCESS",...verifiedKnowledgeStore.snapshot()});
  }
  if(req.method==="GET"&&url.pathname==="/api/knowledge/cloud/status"){
    return send(res,200,{state:"SUCCESS",cloud:verifiedKnowledgeCloud.status()});
  }
  if(req.method==="POST"&&url.pathname==="/api/knowledge/cloud/recover"){
    const b=await readBody(req);
    const out=await verifiedKnowledgeStore.recoverFromCloud({verifier:autonomousKnowledge,limit:Number(b.limit||1000)});
    return send(res,out.state==="SUCCESS"?200:409,out);
  }
  if(req.method==="POST"&&url.pathname==="/api/knowledge/cloud/sync"){
    const b=await readBody(req);
    const out=await verifiedKnowledgeStore.syncCloud({limit:Number(b.limit||500)});
    return send(res,out.state==="SUCCESS"?200:409,out);
  }
  if(req.method==="GET"&&url.pathname==="/api/knowledge/jobs"){
    return send(res,200,{state:"SUCCESS",jobs:knowledgeJobStore.list(Number(url.searchParams.get("limit")||50))});
  }
  if(req.method==="GET"&&url.pathname==="/api/knowledge/learning/status"){
    return send(res,200,knowledgeLearningPipeline.status());
  }
  if(req.method==="POST"&&url.pathname==="/api/knowledge/learning/train"){
    const b=await readBody(req);
    const batch=knowledgeTraining.buildBatch(Number(b.limit||100));
    const out=await knowledgeLearningPipeline.trainCandidate(batch,{steps:Number(b.steps||20),preset:String(b.preset||"termux-tiny")});
    return send(res,out.state==="SUCCESS"?200:409,out);
  }
  if(req.method==="POST"&&url.pathname==="/api/knowledge/learning/evaluate"){
    const b=await readBody(req);
    const out=await knowledgeLearningPipeline.evaluateCandidate(String(b.jobId||""),{maxRelativeRegression:Number(b.maxRelativeRegression??0.02)});
    return send(res,out.state==="SUCCESS"?200:409,out);
  }
  if(req.method==="POST"&&url.pathname==="/api/knowledge/model/promote"){
    const b=await readBody(req);
    const out=knowledgeLearningPipeline.promoteCandidate(String(b.jobId||""),{approved:true,approvalId:String(b.approvalId||req.headers["x-uai-approval-id"]||"")});
    return send(res,out.state==="SUCCESS"?200:409,out);
  }
  if(req.method==="POST"&&url.pathname==="/api/knowledge/model/rollback"){
    const b=await readBody(req);
    const out=knowledgeLearningPipeline.rollbackPromotion(String(b.jobId||""),{reason:String(b.reason||"owner-requested rollback")});
    return send(res,out.state==="SUCCESS"?200:409,out);
  }

  if(req.method==="GET"&&url.pathname==="/api/status"){
    const auth=identity.authenticateRequest(req),deps=dependencyStatus(),model=await forgelm.status(),lg=await langgraph.status(),services=runtimeServices.status(),storage=await storageDb.status(),documents=await documentStore.status(),capabilities=await capabilitySnapshot(),availability=availabilityLedger.record(capabilities);
    return send(res,200,{state:"SUCCESS",name:"IntraultUniversalion",version:APP_VERSION,surface:"OneChat",auth:identity.status(auth),doctrine:{laws:THREE_LAWS,governance:GOVERNANCE},sourceResearch:{count:sourceRegistry.length,policy:"Core research capabilities use governed public/open source references; proprietary model internals are never assumed."},capabilities,capabilitySummary:{connected:capabilities.filter(x=>x.availability==="CONNECTED").length,total:capabilities.length,configured:capabilities.filter(x=>x.availability==="CONFIGURED").length},availabilityEvidence:availability,taskSummary:{persisted:taskStore.list({limit:10000}).length},actionEnvelopeSummary:{persisted:actionEnvelopes.list(10000).length},optionalExternalAdapters:providerHub.list(),runtimeServices:services,langgraph:lg,storageDatabase:storage,documentDataPlane:documents,languageData:{definitions:storage.counts?.definitions||0,dialogueMessages:storage.counts?.dialogue_messages||0,sources:storage.counts?.sources||0},knowledgeCount:store.list().length,auditCount:audit.list(10000).length,agentCount:agents.list().length,pluginCount:control.plugins.list().length,accountCount:control.accounts.list().length,subscriptionCount:control.subscriptions.list().length,neuralDependencies:deps,forgelm:model,releaseIntegrity:verifyRelease(__dirname),modelLab:modelLab.status(),governanceDatabase:taskStore.db.status(),modelRegistry:modelRegistry.status(),modelRouter:modelRouter.describe(),pluginRegistry:{count:pluginRegistry.list().length},pluginGateway:{version:"0.44",sandboxConfigured:pluginGateway.sandboxRunner.configured()},governanceKernel:governanceKernel.status(auth),ownerAuthentication:{mode:"email-password-session",legacyBearerTokenAccepted:false,bootstrapState:ownerBootstrap.state,bootstrapApplied:ownerBootstrap.bootstrapped===true},shadow:shadow.status(),light:light.status(),controlPlane:{scheduler:agentScheduler.status(),storage:agentScheduler.db.status()},memory:auth.authenticated?memoryStore.status(auth.identityId):{state:"LOCKED",message:"Owner authentication required for memory status."},provenance:provenanceGraph.status(),evaluations:evaluationStore.status(),modelArtifacts:{count:modelArtifactVerifier.list(10000).length},policySimulation:{count:policySimulator.list(10000).length},platformCatalogSummary:{partialOrNotDemonstrated:platformCatalog.partialOrNotDemonstrated.length,modelCategories:platformCatalog.modelCategories.length,pluginTypes:platformCatalog.pluginTypes.length,toolAbilities:platformCatalog.toolAbilities.length},auditIntegrity:audit.verify(),requestId,correlationId});
  }
  if(req.method==="GET"&&url.pathname==="/api/research/sources")return send(res,200,{state:"SUCCESS",sources:sourceRegistry});
  if(req.method==="GET"&&url.pathname==="/api/models")return send(res,200,modelRegistry.status());
  if(req.method==="GET"&&url.pathname==="/api/models/route"){
    const requirements={
      task:url.searchParams.get("task")||"chat",
      modality:url.searchParams.get("modality")||"text",
      privacy:url.searchParams.get("privacy")||"local-only",
      offline:url.searchParams.get("offline")==="true",
      contextTokens:Number(url.searchParams.get("contextTokens")||0)||undefined,
      maxLatencyMs:Number(url.searchParams.get("maxLatencyMs")||0)||undefined
    };
    const routed=await modelRouter.route(requirements);
    if(routed.ranked)delete routed.ranked;
    return send(res,200,routed);
  }
  if(req.method==="GET"&&url.pathname==="/api/model-runtime/llamacpp")return send(res,200,await llamaRuntime.status());
  if(req.method==="GET"&&url.pathname==="/api/observability")return send(res,200,observability.summary());
  if(req.method==="GET"&&url.pathname==="/api/plugins-v1")return send(res,200,{state:"SUCCESS",plugins:pluginRegistry.list()});
  if(req.method==="POST"&&url.pathname==="/api/plugins-v1/register"){const b=await readBody(req);return send(res,200,pluginRegistry.register(b.manifest||b));}
  if(req.method==="POST"&&url.pathname==="/api/plugins-v1/execute"){
    const b=await readBody(req);
    const controller=new AbortController();
    req.once("aborted",()=>controller.abort());
    res.once("close",()=>{if(!res.writableEnded)controller.abort();});
    const idempotencyKey=String(req.headers["idempotency-key"]||b.idempotencyKey||"").trim()||null;
    return send(res,200,await pluginGateway.execute(String(b.pluginId||""),String(b.operation||"execute"),b.input||{},{
      approvalId:b.approvalId||null,
      autonomyLeaseId:b.autonomyLeaseId||b.leaseId||null,
      idempotencyKey,
      actionEnvelopeId:b.actionEnvelopeId||null,
      taskId:b.taskId||null,
      signal:controller.signal
    }));
  }
  if(req.method==="GET"&&url.pathname==="/api/memory/status")return send(res,200,{...memoryStore.status(req.uaiSecurity.auth.identityId),settings:memoryStore.settings(req.uaiSecurity.auth.identityId)});
  if(req.method==="GET"&&url.pathname==="/api/memory")return send(res,200,{state:"SUCCESS",items:memoryStore.list({ownerId:req.uaiSecurity.auth.identityId,namespace:url.searchParams.get("namespace")||null,limit:Number(url.searchParams.get("limit")||50),includeDeleted:url.searchParams.get("includeDeleted")==="true"})});
  if(req.method==="GET"&&url.pathname==="/api/memory/search")return send(res,200,memoryStore.search(url.searchParams.get("q")||"",{ownerId:req.uaiSecurity.auth.identityId,namespace:url.searchParams.get("namespace")||null,limit:Number(url.searchParams.get("limit")||10)}));
  if(req.method==="GET"&&url.pathname==="/api/memory/why")return send(res,200,memoryStore.why(url.searchParams.get("id")||"",req.uaiSecurity.auth.identityId));
  if(req.method==="GET"&&url.pathname==="/api/memory/export")return send(res,200,memoryStore.export(req.uaiSecurity.auth.identityId,{includeDeleted:url.searchParams.get("includeDeleted")==="true"}));
  if(req.method==="POST"&&url.pathname==="/api/memory/remember"){const b=await readBody(req);return send(res,200,memoryStore.remember({...b,ownerId:req.uaiSecurity.auth.identityId}));}
  if(req.method==="POST"&&url.pathname==="/api/memory/settings"){const b=await readBody(req);return send(res,200,memoryStore.setSettings(req.uaiSecurity.auth.identityId,b));}
  if(req.method==="POST"&&url.pathname==="/api/memory/forget"){const b=await readBody(req);return send(res,200,memoryStore.forget(b.id,req.uaiSecurity.auth.identityId,b.reason));}
  if(req.method==="POST"&&url.pathname==="/api/memory/forget-source"){const b=await readBody(req);return send(res,200,memoryStore.forgetSource(b.sourceId,req.uaiSecurity.auth.identityId,b.reason));}
  if(req.method==="POST"&&url.pathname==="/api/memory/purge"){const b=await readBody(req);return send(res,200,memoryStore.purge(b.id,req.uaiSecurity.auth.identityId,b.reason));}
  if(req.method==="POST"&&url.pathname==="/api/memory/maintenance"){const b=await readBody(req);return send(res,200,memoryStore.maintenance(Number(b.now)||Date.now()));}
  if(req.method==="GET"&&url.pathname==="/api/provenance/status")return send(res,200,provenanceGraph.status());
  if(req.method==="GET"&&url.pathname==="/api/provenance/nodes")return send(res,200,{state:"SUCCESS",nodes:provenanceGraph.listNodes({limit:Number(url.searchParams.get("limit")||100),type:url.searchParams.get("type")||null})});
  if(req.method==="GET"&&url.pathname==="/api/provenance/trace")return send(res,200,provenanceGraph.trace(url.searchParams.get("id")||"",{direction:url.searchParams.get("direction")||"both",depth:Number(url.searchParams.get("depth")||3)}));
  if(req.method==="GET"&&url.pathname==="/api/provenance/purge-plan")return send(res,200,provenanceGraph.planPurge(url.searchParams.get("id")||""));
  if(req.method==="POST"&&url.pathname==="/api/provenance/nodes"){const b=await readBody(req);return send(res,200,provenanceGraph.addNode({...b,ownerId:req.uaiSecurity.auth.identityId}));}
  if(req.method==="POST"&&url.pathname==="/api/provenance/edges")return send(res,200,provenanceGraph.addEdge(await readBody(req)));
  if(req.method==="POST"&&url.pathname==="/api/provenance/purge"){const b=await readBody(req);return send(res,200,provenanceGraph.purge(b.id,{apply:b.apply===true,ownerId:req.uaiSecurity.auth.identityId,reason:b.reason||"user-requested purge"}));}
  if(req.method==="GET"&&url.pathname==="/api/model-artifacts")return send(res,200,{state:"SUCCESS",artifacts:modelArtifactVerifier.list(Number(url.searchParams.get("limit")||100))});
  if(req.method==="POST"&&url.pathname==="/api/model-artifacts/verify")return send(res,200,modelArtifactVerifier.verify(await readBody(req)));
  if(req.method==="POST"&&url.pathname==="/api/model-artifacts/register")return send(res,200,modelArtifactVerifier.register(await readBody(req)));
  if(req.method==="GET"&&url.pathname==="/api/evaluations/status")return send(res,200,evaluationStore.status());
  if(req.method==="GET"&&url.pathname==="/api/evaluations")return send(res,200,{state:"SUCCESS",evaluations:evaluationStore.list({limit:Number(url.searchParams.get("limit")||100),subjectId:url.searchParams.get("subjectId")||null,category:url.searchParams.get("category")||null})});
  if(req.method==="GET"&&url.pathname==="/api/evaluations/leaderboard")return send(res,200,evaluationStore.leaderboard({category:url.searchParams.get("category")||null,metric:url.searchParams.get("metric")||null,limit:Number(url.searchParams.get("limit")||10)}));
  if(req.method==="POST"&&url.pathname==="/api/evaluations/record")return send(res,200,evaluationStore.record(await readBody(req)));
  if(req.method==="POST"&&url.pathname==="/api/policy/simulate"){const b=await readBody(req);return send(res,200,policySimulator.simulate({...b,actor:req.uaiSecurity.auth.identityId}));}
  if(req.method==="GET"&&url.pathname==="/api/policy/simulations")return send(res,200,{state:"SUCCESS",simulations:policySimulator.list(Number(url.searchParams.get("limit")||100))});
  if(req.method==="GET"&&url.pathname==="/api/data-lifecycle")return send(res,200,await storageDb.lifecycleStatus());
  if(req.method==="GET"&&url.pathname==="/api/documents/status")return send(res,200,await documentStore.status());
  if(req.method==="GET"&&url.pathname==="/api/documents")return send(res,200,await documentStore.list({limit:Number(url.searchParams.get("limit")||100),status:url.searchParams.get("status")||null}));
  if(req.method==="GET"&&url.pathname==="/api/documents/get")return send(res,200,await documentStore.get(url.searchParams.get("id")||""));
  if(req.method==="GET"&&url.pathname==="/api/documents/search")return send(res,200,await documentStore.search(url.searchParams.get("q")||"",Number(url.searchParams.get("limit")||8)));
  if(req.method==="POST"&&url.pathname==="/api/documents/ingest")return send(res,200,await documentStore.ingest(await readBody(req)));
  if(req.method==="POST"&&url.pathname==="/api/documents/reindex")return send(res,200,await documentStore.reindex());
  if(req.method==="POST"&&url.pathname==="/api/documents/delete"){const b=await readBody(req);return send(res,200,await documentStore.delete(b.id||"",b.reason||"user-requested deletion"));}
  if(req.method==="POST"&&url.pathname==="/api/documents/purge"){const b=await readBody(req);return send(res,200,await documentStore.purge(b.id||"",b.reason||"user-requested purge"));}
  if(req.method==="GET"&&url.pathname==="/api/storage/status")return send(res,200,await storageDb.status());
  if(req.method==="GET"&&url.pathname==="/api/definitions"){return send(res,200,await storageDb.define(url.searchParams.get("term")||"",Number(url.searchParams.get("limit")||8)));}
  if(req.method==="GET"&&url.pathname==="/api/dialogue/search"){return send(res,200,await storageDb.banter(url.searchParams.get("q")||"",Number(url.searchParams.get("limit")||8),url.searchParams.get("kind")||"all"));}
  if(req.method==="GET"&&url.pathname==="/api/lexicon/related"){return send(res,200,await storageDb.related(url.searchParams.get("term")||"",url.searchParams.get("relation")||"",Number(url.searchParams.get("limit")||8)));}
  if(req.method==="GET"&&url.pathname==="/api/semantic/search"){return send(res,200,await storageDb.semanticSearch(url.searchParams.get("q")||"",url.searchParams.get("kind")||"all",Number(url.searchParams.get("limit")||8)));}
  if(req.method==="POST"&&url.pathname==="/api/semantic/build")return send(res,200,await storageDb.semanticBuild());
  if(req.method==="GET"&&url.pathname==="/api/web/status")return send(res,200,webCorpus.status());
  if(req.method==="POST"&&url.pathname==="/api/capabilities/probe"){const probes=await runtimeServices.probe();const lg=await langgraph.status();const model=await forgelm.status();return send(res,200,{state:"SUCCESS",probes,langgraph:lg,model});}
  if(req.method==="GET"&&url.pathname==="/api/billing/subscriptions"){return send(res,200,await runtimeServices.billing.list({limit:url.searchParams.get("limit")||10,status:url.searchParams.get("status")||null}));}
  if(req.method==="POST"&&url.pathname==="/api/oxford/compare"){const b=await readBody(req);return send(res,200,await runtimeServices.oxford.compare(b.word,b.description));}
  if(req.method==="POST"&&url.pathname==="/api/fabrication/probe")return send(res,200,await runtimeServices.fabrication.probe());
  if(req.method==="POST"&&url.pathname==="/api/fabrication/job"){const b=await readBody(req);return send(res,200,await runtimeServices.fabrication.job(String(b.command||""),b.approval===true));}
  if(req.method==="POST"&&url.pathname==="/api/langgraph/run"){const b=await readBody(req);return send(res,200,await langgraph.run(b.message||""));}
  if(req.method==="POST"&&url.pathname==="/api/web/ingest")return send(res,200,await webCorpus.ingestUrl(await readBody(req)));
  if(req.method==="GET"&&url.pathname==="/api/knowledge")return send(res,200,store.list());
  if(req.method==="GET"&&url.pathname==="/api/agents")return send(res,200,agents.list());
  if(req.method==="GET"&&url.pathname==="/api/platform/roadmap")return send(res,200,platformCatalog);
  if(req.method==="GET"&&url.pathname==="/api/governance/status")return send(res,200,governanceKernel.status(identity.authenticateRequest(req)));
  if(req.method==="GET"&&url.pathname==="/api/governance/trusted-devices")return send(res,200,{state:"SUCCESS",devices:governanceKernel.trustedDevices.list(1000)});
  if(req.method==="POST"&&url.pathname==="/api/governance/emergency/engage"){const b=await readBody(req);return send(res,200,governanceKernel.emergencyStop.engage(b.reason||"owner emergency stop"));}
  if(req.method==="POST"&&url.pathname==="/api/governance/emergency/release"){const b=await readBody(req);return send(res,200,governanceKernel.emergencyStop.release(req.uaiSecurity,b.reason||"owner release"));}
  if(req.method==="POST"&&url.pathname==="/api/governance/trusted-devices/enroll"){const b=await readBody(req);return send(res,200,governanceKernel.trustedDevices.enroll(b,req.uaiSecurity));}
  if(req.method==="POST"&&url.pathname==="/api/governance/trusted-devices/revoke"){const b=await readBody(req);return send(res,200,governanceKernel.trustedDevices.revoke(b.id,req.uaiSecurity));}
  if(req.method==="GET"&&url.pathname==="/api/control-plane/status")return send(res,200,{state:"SUCCESS",scheduler:agentScheduler.status(),storage:agentScheduler.db.status()});
  if(req.method==="GET"&&url.pathname==="/api/control-plane/dashboard"){
    const capabilities=await capabilitySnapshot(),taskRows=taskStore.list({limit:10000}),approvalRows=approvalStore.list({limit:10000}),shadowRuns=shadow.runs.list({limit:10000}),lightPatches=light.list({limit:10000}),jobs=agentScheduler.list({limit:10000}),plugins=pluginRegistry.list(),modelStatus=modelRegistry.status(),evidenceRows=featureEvidence.features||[],auditRows=audit.list(10000),ownerId=req.uaiSecurity.auth.identityId,memoryItems=memoryStore.list({ownerId,limit:10000}),provStatus=provenanceGraph.status(),evalStatus=evaluationStore.status(),artifactRows=modelArtifactVerifier.list(10000),policySims=policySimulator.list(10000);
    return send(res,200,{state:"SUCCESS",generatedFor:featureEvidence.generated_for,tasks:{total:taskRows.length,states:countBy(taskRows)},capabilities:{total:capabilities.length,availability:countBy(capabilities,"availability")},models:modelStatus,plugins:{total:plugins.length,enabled:plugins.filter(x=>x.enabled!==false).length},approvals:{total:approvalRows.length,states:countBy(approvalRows,"status")},shadow:{...shadow.status(),states:countBy(shadowRuns),recent:shadowRuns.slice(0,12)},light:{...light.status(),states:countBy(lightPatches),recent:lightPatches.slice(0,12)},scheduler:{...agentScheduler.status(),states:countBy(jobs),recent:jobs.slice(0,20)},memory:{...memoryStore.status(ownerId),namespaces:countBy(memoryItems,"namespace"),settings:memoryStore.settings(ownerId)},provenance:provStatus,evaluations:evalStatus,modelArtifacts:{total:artifactRows.length,states:countBy(artifactRows)},policySimulations:{total:policySims.length,decisions:countBy(policySims,"overallDecision")},evidence:{total:evidenceRows.length,statuses:countBy(evidenceRows,"status"),features:evidenceRows.map(x=>({id:x.id,introduced:x.introduced,status:x.status,evidence_note:x.evidence_note}))},audit:{total:auditRows.length,integrity:audit.verify(),recent:auditRows.slice(-20).reverse()}});
  }
  if(req.method==="GET"&&url.pathname==="/api/control-plane/jobs")return send(res,200,{state:"SUCCESS",jobs:agentScheduler.list({limit:Number(url.searchParams.get("limit")||100),state:url.searchParams.get("state")||null,queue:url.searchParams.get("queue")||null})});
  if(req.method==="POST"&&url.pathname==="/api/control-plane/dispatch"){const b=await readBody(req),queue=String(b.queue||"").trim(),workerId=String(b.workerId||`api-${queue||"worker"}`);if(queue==="shadow")return send(res,200,await shadow.dispatchNext(workerId));if(queue==="light")return send(res,200,await light.dispatchNext(workerId));return send(res,400,{state:"BLOCKED",message:"queue must be shadow or light."});}
  if(req.method==="POST"&&url.pathname==="/api/control-plane/maintenance"){const b=await readBody(req),now=Number(b.now)||Date.now();return send(res,200,{state:"SUCCESS",shadow:shadow.maintenance(now),light:light.maintenance(now),scheduler:agentScheduler.status()});}
  if(req.method==="GET"&&url.pathname==="/api/shadow/status")return send(res,200,shadow.status());
  if(req.method==="GET"&&url.pathname==="/api/shadow/agents")return send(res,200,{state:"SUCCESS",agents:shadow.registry.list()});
  if(req.method==="GET"&&url.pathname==="/api/shadow/runs")return send(res,200,{state:"SUCCESS",runs:shadow.runs.list({limit:Number(url.searchParams.get("limit")||100),state:url.searchParams.get("state")||null})});
  if(req.method==="GET"&&url.pathname==="/api/shadow/candidates")return send(res,200,{state:"SUCCESS",candidates:shadow.candidates.list(Number(url.searchParams.get("limit")||100))});
  if(req.method==="POST"&&url.pathname==="/api/shadow/runs")return send(res,200,shadow.submit(await readBody(req)));
  if(req.method==="POST"&&url.pathname==="/api/shadow/dispatch"){const b=await readBody(req);return send(res,200,await shadow.dispatchNext(String(b.workerId||"shadow-api-worker")));}
  if(req.method==="POST"&&url.pathname==="/api/shadow/maintenance"){const b=await readBody(req);return send(res,200,shadow.maintenance(Number(b.now)||Date.now()));}
  if(req.method==="POST"&&url.pathname==="/api/shadow/simulate"){const b=await readBody(req);return send(res,200,await shadow.simulate(b.id,{evidence:b.evidence||[],observations:b.observations||[]},b.options||{}));}
  if(req.method==="POST"&&url.pathname==="/api/shadow/reject"){const b=await readBody(req);return send(res,200,shadow.reject(b.candidateId,b.reason));}
  if(req.method==="GET"&&url.pathname==="/api/light/status")return send(res,200,light.status());
  if(req.method==="GET"&&url.pathname==="/api/light/agents")return send(res,200,{state:"SUCCESS",agents:light.registry.list()});
  if(req.method==="GET"&&url.pathname==="/api/light/patches")return send(res,200,{state:"SUCCESS",patches:light.list({limit:Number(url.searchParams.get("limit")||100),state:url.searchParams.get("state")||null})});
  if(req.method==="POST"&&url.pathname==="/api/light/patches")return send(res,200,light.propose(await readBody(req)));
  if(req.method==="POST"&&url.pathname==="/api/light/dispatch"){const b=await readBody(req);return send(res,200,await light.dispatchNext(String(b.workerId||"light-api-worker")));}
  if(req.method==="POST"&&url.pathname==="/api/light/maintenance"){const b=await readBody(req);return send(res,200,light.maintenance(Number(b.now)||Date.now()));}
  if(req.method==="POST"&&url.pathname==="/api/light/worktree"){const b=await readBody(req);return send(res,200,light.createWorktree(b.id));}
  if(req.method==="POST"&&url.pathname==="/api/light/implementation"){const b=await readBody(req);return send(res,200,light.recordImplementation(b.id,{changedFiles:b.changedFiles||[],evidence:b.evidence||[]}));}
  if(req.method==="POST"&&url.pathname==="/api/light/evaluate"){const b=await readBody(req),{id,...input}=b;return send(res,200,light.evaluate(id,input));}
  if(req.method==="POST"&&url.pathname==="/api/light/rollback"){const b=await readBody(req);return send(res,200,light.rollback(b.id,b.reason));}
  if(req.method==="POST"&&url.pathname==="/api/promotion/shadow"){const b=await readBody(req);return send(res,200,shadow.promote(b.candidateId,req.uaiSecurity,{evidence:b.evidence===true,evaluation:b.evaluation||null}));}
  if(req.method==="POST"&&url.pathname==="/api/promotion/light"){const b=await readBody(req);return send(res,200,light.markPromotionEligible(b.patchId,req.uaiSecurity));}
  if(req.method==="GET"&&url.pathname==="/api/plugins")return send(res,200,control.plugins.list());
  if(req.method==="GET"&&url.pathname==="/api/accounts")return send(res,200,control.accounts.list());
  if(req.method==="GET"&&url.pathname==="/api/subscriptions")return send(res,200,control.subscriptions.list());
  if(req.method==="GET"&&url.pathname==="/api/audit")return send(res,200,audit.list(Number(url.searchParams.get("limit")||100)));
  if(req.method==="GET"&&url.pathname==="/api/audit/verify")return send(res,200,audit.verify());
  if(req.method==="GET"&&url.pathname==="/api/source/inspect")return send(res,200,workspace.inspect(url.searchParams.get("path")||"package.json"));
  if(req.method==="POST"&&url.pathname==="/api/research")return send(res,200,research.examine(await readBody(req)));
  if(req.method==="POST"&&url.pathname==="/api/plugins/register")return send(res,200,{state:"SUCCESS",plugin:control.registerPlugin(await readBody(req))});
  if(req.method==="POST"&&url.pathname==="/api/accounts")return send(res,200,{state:"SUCCESS",account:control.addAccount(await readBody(req))});
  if(req.method==="POST"&&url.pathname==="/api/subscriptions")return send(res,200,{state:"SUCCESS",subscription:control.addSubscription(await readBody(req))});
  if(req.method==="POST"&&url.pathname==="/api/knowledge/export"){const b=await readBody(req);const record=store.get(b.id);return record?send(res,200,{state:"SUCCESS",record:exportKnowledgeRecord(record)}):send(res,404,{state:"FAILURE",message:"Knowledge record not found."});}
  if(req.method==="POST"&&url.pathname==="/api/knowledge/import"){const b=await readBody(req);const decoded=importKnowledgeRecord(b.record);const stored=store.importRecord(decoded);audit.append({type:"knowledge.imported",id:decoded.id,ownerId:req.uaiSecurity.auth.identityId});return send(res,200,{state:"SUCCESS",record:stored});}
  if(req.method==="POST"&&url.pathname==="/api/agents/spawn")return send(res,200,agents.spawn(await readBody(req)));
  if(req.method==="GET"&&url.pathname==="/api/tasks")return send(res,200,{state:"SUCCESS",tasks:taskStore.list({limit:Number(url.searchParams.get("limit")||100),state:url.searchParams.get("state")||null})});
  if(req.method==="GET"&&url.pathname==="/api/tasks/status")return send(res,200,tasks.status(url.searchParams.get("id")||""));
  if(req.method==="POST"&&url.pathname==="/api/tasks/plan")return send(res,200,tasks.plan((await readBody(req)).request||""));
  if(req.method==="POST"&&url.pathname==="/api/tasks/run")return send(res,200,await tasks.run(await readBody(req)));
  if(req.method==="POST"&&url.pathname==="/api/tasks/resume"){const b=await readBody(req);return send(res,200,await tasks.resume(b.id||b.taskId||""));}
  if(req.method==="POST"&&url.pathname==="/api/tasks/cancel"){const b=await readBody(req);return send(res,200,tasks.cancel(b.id||b.taskId||""));}
  if(req.method==="GET"&&url.pathname==="/api/actions")return send(res,200,{state:"SUCCESS",actions:url.searchParams.get("id")?[actionEnvelopes.get(url.searchParams.get("id"))].filter(Boolean):actionEnvelopes.list({limit:Number(url.searchParams.get("limit")||100)})});
  if(req.method==="GET"&&url.pathname==="/api/availability")return send(res,200,{state:"SUCCESS",snapshot:availabilityLedger.latest()});
  if(req.method==="POST"&&url.pathname==="/api/policy/evaluate")return send(res,200,policyEngine.evaluate(await readBody(req)));
  if(req.method==="GET"&&url.pathname==="/api/approvals")return send(res,200,{state:"SUCCESS",approvals:approvalStore.list({status:url.searchParams.get("status")||null,limit:Number(url.searchParams.get("limit")||100)})});
  if(req.method==="POST"&&url.pathname==="/api/approvals/request")return send(res,200,{state:"SUCCESS",approval:approvalStore.request(await readBody(req))});
  if(req.method==="POST"&&url.pathname==="/api/approvals/decide"){const b=await readBody(req);return send(res,200,approvalStore.decide(b.id||b.approvalId,b.decision));}
  if(req.method==="GET"&&url.pathname==="/api/autonomy")return send(res,200,{state:"SUCCESS",leases:autonomyStore.list()});
  if(req.method==="POST"&&url.pathname==="/api/autonomy/grant")return send(res,200,autonomyStore.grant(await readBody(req)));
  if(req.method==="POST"&&url.pathname==="/api/autonomy/revoke"){const b=await readBody(req);return send(res,200,autonomyStore.revoke(b.id||b.leaseId));}
  if(req.method==="POST"&&url.pathname==="/api/autonomy/authorize"){const b=await readBody(req);return send(res,200,autonomyStore.authorize(b.id||b.leaseId,b));}
  if(req.method==="POST"&&url.pathname==="/api/knowledge/search"){const b=await readBody(req);return send(res,200,{state:"SUCCESS",results:knowledge.search(b.query,b.limit||10)});}
  if(req.method==="POST"&&url.pathname==="/api/knowledge/compare-definition"){const b=await readBody(req);return send(res,200,knowledge.compareDefinition(b.term,b.description));}
  if(req.method==="POST"&&url.pathname==="/api/develop")return send(res,200,development.propose(await readBody(req)));
  if(req.method==="POST"&&url.pathname==="/api/develop/apply"){const b=await readBody(req);return send(res,200,development.apply(b.proposalId,b.approvalId));}
  if(req.method==="POST"&&url.pathname==="/api/source/rollback"){const b=await readBody(req);return send(res,200,workspace.rollback(b.snapshotId,b.approval===true));}
  if(req.method==="GET"&&url.pathname==="/api/provider/status")return send(res,200,{state:"SUCCESS",providers:providerHub.list()});
  if(req.method==="POST"&&url.pathname==="/api/provider/chat"){const b=await readBody(req);const result=await providerHub.chat(b.provider,b.message,b.system,b.options||{});if(result.state==="SUCCESS"&&b.store){await store.put(b.store,{...result,provider:b.provider});}return send(res,200,result);}
  if(req.method==="POST"&&url.pathname==="/api/provider/vision"){const b=await readBody(req);return send(res,200,await providerHub.vision(b.provider,b.message,b.images||[],b.options||{}));}
  if(req.method==="POST"&&url.pathname==="/api/provider/image"){const b=await readBody(req);return send(res,200,await providerHub.image(b.provider,b.prompt||b.message||"",b.options||{}));}
  if(req.method==="POST"&&url.pathname==="/api/provider/media"){const b=await readBody(req);return send(res,200,await providerHub.media(b.provider,b.message||b.prompt||"",b.media||b.files||[],b.options||{}));}
  if(req.method==="POST"&&url.pathname==="/api/provider/structured"){const b=await readBody(req);return send(res,200,await providerHub.structured(b.provider,b.message,b.schema,b.options||{}));}
  if(req.method==="POST"&&url.pathname==="/api/provider/embeddings"){const b=await readBody(req);return send(res,200,await providerHub.embeddings(b.provider,b.input??b.message??"",b.options||{}));}
  if(req.method==="POST"&&url.pathname==="/api/provider/rerank"){const b=await readBody(req);return send(res,200,await providerHub.rerank(b.provider,b.query||"",b.documents||[],b.options||{}));}
  if(req.method==="POST"&&url.pathname==="/api/selfdev/stage"){const b=await readBody(req);return send(res,200,selfdev.stage(b.proposalId));}
  if(req.method==="POST"&&url.pathname==="/api/selfdev/promote"){const b=await readBody(req);return send(res,200,selfdev.promote(b.stageId,b.approvalId));}
  if(req.method==="GET"&&url.pathname==="/api/selfdev")return send(res,200,selfdev.list());
  if(req.method==="POST"&&url.pathname==="/api/learning/export")return send(res,200,learning.build(await readBody(req)));
  if(req.method==="GET"&&url.pathname==="/api/model/status")return send(res,200,await forgelm.status());
  if(req.method==="GET"&&url.pathname==="/api/model/lab")return send(res,200,modelLab.status());
  if(req.method==="POST"&&url.pathname==="/api/model/dataset")return send(res,200,await modelLab.prepareDataset());
  if(req.method==="POST"&&url.pathname==="/api/model/benchmark")return send(res,200,await modelLab.benchmark());
  if(req.method==="POST"&&url.pathname==="/api/model/tokenizer/train"){const b=await readBody(req);return send(res,200,await modelLab.trainTokenizer(b.vocabSize||512));}
  if(req.method==="POST"&&url.pathname==="/api/research/source-snapshot")return send(res,200,await modelLab.analyzeSources());
  if(req.method==="POST"&&url.pathname==="/api/model/train"){const b=await readBody(req);return send(res,200,await modelLab.train({steps:b.steps||80,preset:b.preset||"termux-tiny",gradAccum:b.gradAccum||1,lr:b.lr||0.003}));}
  if(req.method==="POST"&&url.pathname==="/api/model/evaluate"){const b=await readBody(req);const out=await modelLab.evaluateCandidate(String(b.runId||""),{maxRelativeRegression:Number(b.maxRelativeRegression??0.02)});return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="POST"&&url.pathname==="/api/model/promote"){const b=await readBody(req);const out=modelLab.promoteCandidate(String(b.runId||""),{approved:true,approvalId:String(b.approvalId||req.headers["x-uai-approval-id"]||"")});return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="POST"&&url.pathname==="/api/model/rollback"){const b=await readBody(req);const out=modelLab.rollback(String(b.runId||""),{reason:String(b.reason||"owner-requested rollback")});return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="GET"&&url.pathname==="/api/vision/status")return send(res,200,{state:"SUCCESS",lifecycle:forgeVisionCandidatePromotion.status(),runtime:await forgelm.visionStatus()});
  if(req.method==="POST"&&url.pathname==="/api/vision/evaluate"){const b=await readBody(req);const out=await forgeVisionCandidatePromotion.evaluate({candidate:String(b.candidate||""),dataset:String(b.dataset||""),minCosine:Number(b.minCosine??0.05),maxRelativeRegression:Number(b.maxRelativeRegression??0.02)});return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="POST"&&url.pathname==="/api/vision/promote"){const b=await readBody(req);const evaluation=b.evaluation||{};const out=forgeVisionCandidatePromotion.promote({candidate:String(b.candidate||evaluation.candidate||""),evaluation,approved:true,approvalId:String(b.approvalId||req.headers["x-uai-approval-id"]||"")});return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="POST"&&url.pathname==="/api/vision/rollback"){const b=await readBody(req);const out=forgeVisionCandidatePromotion.rollback(String(b.rollbackId||""),{reason:String(b.reason||"owner-requested vision rollback")});return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="POST"&&url.pathname==="/api/vision/describe"){const b=await readBody(req);const roots=[path.resolve(__dirname,"model","data"),path.resolve(stateDir,"vision-inputs")],target=path.resolve(String(b.image||""));if(!roots.some(root=>target===root||target.startsWith(root+path.sep)))return send(res,403,{state:"DENIED",message:"Vision input path is outside approved local roots."});const out=await forgelm.visionDescribe(target,String(b.prompt||"Describe the image using only what the visual evidence supports."),Number(b.maxTokens||96));return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="GET"&&url.pathname==="/api/audio/status")return send(res,200,{state:"SUCCESS",lifecycle:forgeAudioCandidatePromotion.status(),runtime:await forgelm.audioStatus()});
  if(req.method==="POST"&&url.pathname==="/api/audio/evaluate"){const b=await readBody(req);const out=await forgeAudioCandidatePromotion.evaluate({candidate:String(b.candidate||""),dataset:String(b.dataset||""),minCosine:Number(b.minCosine??0.05),maxRelativeRegression:Number(b.maxRelativeRegression??0.02)});return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="POST"&&url.pathname==="/api/audio/promote"){const b=await readBody(req);const evaluation=b.evaluation||{};const out=forgeAudioCandidatePromotion.promote({candidate:String(b.candidate||evaluation.candidate||""),evaluation,approved:true,approvalId:String(b.approvalId||req.headers["x-uai-approval-id"]||"")});return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="POST"&&url.pathname==="/api/audio/rollback"){const b=await readBody(req);const out=forgeAudioCandidatePromotion.rollback(String(b.rollbackId||""),{reason:String(b.reason||"owner-requested audio rollback")});return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="POST"&&url.pathname==="/api/audio/describe"){const b=await readBody(req);const roots=[path.resolve(__dirname,"model","data"),path.resolve(stateDir,"audio-inputs")],target=path.resolve(String(b.audio||""));if(!roots.some(root=>target===root||target.startsWith(root+path.sep)))return send(res,403,{state:"DENIED",message:"Audio input path is outside approved local roots."});const out=await forgelm.audioDescribe(target,String(b.prompt||"Describe or transcribe the audio using only the acoustic evidence."),Number(b.maxTokens||96));return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="GET"&&url.pathname==="/api/speech/status")return send(res,200,{state:"SUCCESS",lifecycle:forgeSpeechCandidatePromotion.status(),runtime:await forgelm.speechStatus()});
  if(req.method==="POST"&&url.pathname==="/api/speech/evaluate"){const b=await readBody(req);const out=await forgeSpeechCandidatePromotion.evaluate({candidate:String(b.candidate||""),dataset:String(b.dataset||""),maxLoss:Number(b.maxLoss??2.0),maxRelativeRegression:Number(b.maxRelativeRegression??0.02)});return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="POST"&&url.pathname==="/api/speech/promote"){const b=await readBody(req);const evaluation=b.evaluation||{};const out=forgeSpeechCandidatePromotion.promote({candidate:String(b.candidate||evaluation.candidate||""),evaluation,approved:true,approvalId:String(b.approvalId||req.headers["x-uai-approval-id"]||"")});return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="POST"&&url.pathname==="/api/speech/rollback"){const b=await readBody(req);const out=forgeSpeechCandidatePromotion.rollback(String(b.rollbackId||""),{reason:String(b.reason||"owner-requested speech rollback")});return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="POST"&&url.pathname==="/api/speech/synthesize"){const b=await readBody(req);const root=path.resolve(stateDir,"speech-output");fs.mkdirSync(root,{recursive:true});const name=String(b.output||(`speech-${Date.now()}.wav`)).replace(/[^A-Za-z0-9._-]/g,"_");const target=path.resolve(root,name);if(!(target===root||target.startsWith(root+path.sep)))return send(res,403,{state:"DENIED",message:"Speech output path is outside the approved local root."});const out=await forgelm.speechSynthesize(String(b.text||""),target);return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="GET"&&url.pathname==="/api/video/status")return send(res,200,{state:"SUCCESS",lifecycle:forgeVideoCandidatePromotion.status(),runtime:await forgelm.videoStatus()});
  if(req.method==="POST"&&url.pathname==="/api/video/evaluate"){const b=await readBody(req);const out=await forgeVideoCandidatePromotion.evaluate({candidate:String(b.candidate||""),dataset:String(b.dataset||""),minCosine:Number(b.minCosine??0.05),maxRelativeRegression:Number(b.maxRelativeRegression??0.02)});return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="POST"&&url.pathname==="/api/video/promote"){const b=await readBody(req);const evaluation=b.evaluation||{};const out=forgeVideoCandidatePromotion.promote({candidate:String(b.candidate||evaluation.candidate||""),evaluation,approved:true,approvalId:String(b.approvalId||req.headers["x-uai-approval-id"]||"")});return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="POST"&&url.pathname==="/api/video/rollback"){const b=await readBody(req);const out=forgeVideoCandidatePromotion.rollback(String(b.rollbackId||""),{reason:String(b.reason||"owner-requested video rollback")});return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="POST"&&url.pathname==="/api/video/describe"){const b=await readBody(req);const roots=[path.resolve(__dirname,"model","data"),path.resolve(stateDir,"video-inputs"),path.resolve(stateDir,"media-input")],target=path.resolve(String(b.video||""));if(!roots.some(root=>target===root||target.startsWith(root+path.sep)))return send(res,403,{state:"DENIED",message:"Video input path is outside approved local roots."});const out=await forgelm.videoDescribe(target,String(b.prompt||"Describe the video using only the temporal and visual evidence."),Number(b.maxTokens||96));return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="GET"&&url.pathname==="/api/media/status")return send(res,200,multimodalPipeline.status());
  if(req.method==="GET"&&url.pathname==="/api/media/list"){const artifacts=multimodalPipeline.list(Math.max(1,Math.min(500,Number(url.searchParams.get("limit")||100)))).map(a=>({id:a.id,sourceId:a.sourceId||null,ownerId:a.ownerId||null,modality:a.modality,mediaType:a.mediaType||null,contentHash:a.contentHash||null,bytes:Number(a.bytes||0),metadata:a.metadata||{},state:a.state||"UNKNOWN",createdAt:a.createdAt||null,updatedAt:a.updatedAt||null}));return send(res,200,{state:"SUCCESS",artifacts});}
  if(req.method==="GET"&&url.pathname==="/api/media/content"){
    const id=String(url.searchParams.get("id")||""),d=multimodalPipeline.contentDescriptor(id,{ownerId:req.uaiSecurity.auth.identityId});
    if(d.state!=="SUCCESS")return send(res,d.state==="DENIED"?403:404,d);
    res.writeHead(200,{
      "content-type":d.mediaType||"application/octet-stream",
      "content-length":String(d.bytes),
      "content-disposition":`inline; filename="${String(d.label||"media").replace(/["\\\r\n]/g,"_")}"`,
      "cache-control":"private, no-store",
      "x-content-type-options":"nosniff"
    });
    return fs.createReadStream(d.file).pipe(res);
  }
  if(req.method==="POST"&&url.pathname==="/api/media/upload"){
    const b=await readBody(req),uploadId=String(b.uploadId||"");
    if(!/^[A-Za-z0-9_-]{8,128}$/.test(uploadId))return send(res,400,{state:"BLOCKED",message:"Invalid uploadId."});
    const index=Number(b.index),total=Number(b.total),name=String(b.name||"attachment.bin").replace(/[^A-Za-z0-9._-]/g,"_").slice(-180);
    if(!Number.isInteger(index)||!Number.isInteger(total)||index<0||total<1||total>256||index>=total)return send(res,400,{state:"BLOCKED",message:"Invalid upload chunk coordinates."});
    const raw=Buffer.from(String(b.data||""),"base64");
    if(!raw.length||raw.length>1_600_000)return send(res,413,{state:"BLOCKED",message:"Upload chunk must be between 1 byte and 1.6 MB."});
    const tempRoot=path.join(stateDir,"upload-temp"),mediaRoot=path.join(stateDir,"media-input");fs.mkdirSync(tempRoot,{recursive:true});fs.mkdirSync(mediaRoot,{recursive:true});
    const part=path.join(tempRoot,uploadId+".part"),metaPath=path.join(tempRoot,uploadId+".json");
    let meta={uploadId,name,total,next:0,bytes:0,mime:String(b.mime||"application/octet-stream"),sourceId:b.sourceId||null};
    if(index===0){try{fs.unlinkSync(part)}catch{};try{fs.unlinkSync(metaPath)}catch{};}
    else{if(!fs.existsSync(metaPath))return send(res,409,{state:"BLOCKED",message:"Upload session is missing; restart from chunk 0."});meta=JSON.parse(fs.readFileSync(metaPath,"utf8"));}
    if(index!==Number(meta.next)||total!==Number(meta.total))return send(res,409,{state:"BLOCKED",message:"Upload chunk is out of sequence.",expectedIndex:meta.next});
    fs.appendFileSync(part,raw);meta.next=index+1;meta.bytes=Number(meta.bytes||0)+raw.length;
    if(meta.bytes>400_000_000){try{fs.unlinkSync(part)}catch{};try{fs.unlinkSync(metaPath)}catch{};return send(res,413,{state:"BLOCKED",message:"Upload exceeds 400 MB media limit."});}
    fs.writeFileSync(metaPath,JSON.stringify(meta),"utf8");
    if(meta.next<total)return send(res,200,{state:"PARTIAL",uploadId,index,nextIndex:meta.next,total,bytes:meta.bytes});
    const digest=sha256FileSync(part),finalName=digest.slice(0,16)+"-"+name,finalPath=path.join(mediaRoot,finalName);
    fs.renameSync(part,finalPath);try{fs.unlinkSync(metaPath)}catch{}
    const registered=multimodalPipeline.register({path:finalPath,sourceId:meta.sourceId||("upload:"+name),ownerId:req.uaiSecurity.auth.identityId,metadata:{originalName:name,mime:meta.mime,uploadId,sha256:digest}});
    if(registered.state!=="SUCCESS")return send(res,409,registered);const a=registered.artifact;return send(res,200,{state:"SUCCESS",artifact:{id:a.id,sourceId:a.sourceId||null,modality:a.modality,mediaType:a.mediaType||null,contentHash:a.contentHash||null,bytes:Number(a.bytes||0),metadata:a.metadata||{}},upload:{uploadId,name,mediaId:a.id,sha256:digest,bytes:meta.bytes}});
  }
  if(req.method==="POST"&&url.pathname==="/api/media/register"){const b=await readBody(req);const out=multimodalPipeline.register({path:String(b.path||""),sourceId:b.sourceId||null,ownerId:req.uaiSecurity.auth.identityId,metadata:b.metadata||{}});return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="POST"&&url.pathname==="/api/media/extract"){const b=await readBody(req);const out=multimodalPipeline.extract(String(b.id||""));return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="GET"&&url.pathname==="/api/multimodal/status")return send(res,200,await forgelm.multimodalStatus());
  if(req.method==="POST"&&url.pathname==="/api/multimodal/chat"){const b=await readBody(req),roots=[path.resolve(__dirname,"model","data"),path.resolve(stateDir,"vision-inputs"),path.resolve(stateDir,"audio-inputs"),path.resolve(stateDir,"video-inputs"),path.resolve(stateDir,"media-input")];const checked={};for(const key of ["image","audio","video"]){if(!b[key])continue;const target=path.resolve(String(b[key]));if(!roots.some(root=>target===root||target.startsWith(root+path.sep)))return send(res,403,{state:"DENIED",message:`${key} input path is outside approved local roots.`});checked[key]=target;}const out=await forgelm.multimodalChat({prompt:String(b.prompt||""),context:String(b.context||""),document:String(b.document||""),image:checked.image||null,audio:checked.audio||null,video:checked.video||null,max:Number(b.maxTokens||128)});return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="POST"&&url.pathname==="/api/model/chat"){const b=await readBody(req);const local=await localOrchestrator.chat(b.message||b.prompt||"", b.context || "");return send(res,200,local);}
  if(req.method==="GET"&&url.pathname==="/api/onechat/conversations")return send(res,200,onechat.conversations({ownerId:req.uaiSecurity.auth.identityId,query:String(url.searchParams.get("q")||""),includeArchived:url.searchParams.get("archived")==="true",limit:Number(url.searchParams.get("limit")||100)}));
  if(req.method==="GET"&&url.pathname==="/api/onechat/export")return send(res,200,onechat.exportConversation(String(url.searchParams.get("chatId")||""),{ownerId:req.uaiSecurity.auth.identityId}));
  if(req.method==="GET"&&url.pathname==="/api/onechat/turn")return send(res,200,onechat.turn(String(url.searchParams.get("turnId")||""),{ownerId:req.uaiSecurity.auth.identityId}));
  if(req.method==="GET"&&url.pathname==="/api/onechat/turn-export")return send(res,200,onechat.exportTurn(String(url.searchParams.get("turnId")||""),{ownerId:req.uaiSecurity.auth.identityId}));
  if(req.method==="POST"&&url.pathname==="/api/onechat/branch"){const b=await readBody(req);const out=onechat.branchFromTurn(String(b.turnId||""),{ownerId:req.uaiSecurity.auth.identityId,includeTurn:b.includeTurn!==false});return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="POST"&&url.pathname==="/api/onechat/retry"){const b=await readBody(req),ownerId=req.uaiSecurity.auth.identityId,t=onechat.turn(String(b.turnId||""),{ownerId});if(t.state!=="SUCCESS")return send(res,t.state==="DENIED"?403:404,t);const branch=onechat.branchFromTurn(t.turn.id,{ownerId,includeTurn:false});if(branch.state!=="SUCCESS")return send(res,409,branch);const attachments=(t.turn.attachments||[]).map(a=>({mediaId:a.id,label:a.label||null,sourceId:a.sourceId||null}));const out=await onechat.handle({chatId:branch.chatId,ownerId,message:String(b.message??t.turn.user),attachments});return send(res,200,{...out,branchedFrom:{chatId:t.turn.chatId,turnId:t.turn.id}});}
  if(req.method==="POST"&&url.pathname==="/api/onechat/conversation"){const b=await readBody(req);const out=onechat.conversationControl(String(b.chatId||""),{ownerId:req.uaiSecurity.auth.identityId,title:b.title,archived:b.archived,deleted:b.deleted});return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="POST"&&url.pathname==="/api/onechat/delete"){const b=await readBody(req);const out=onechat.deleteConversation(String(b.chatId||""),{ownerId:req.uaiSecurity.auth.identityId});return send(res,out.state==="SUCCESS"?200:409,out);}
  if(req.method==="GET"&&url.pathname==="/api/onechat/history")return send(res,200,onechat.history(String(url.searchParams.get("chatId")||""),{limit:Number(url.searchParams.get("limit")||50),ownerId:req.uaiSecurity.auth.identityId}));
  if(req.method==="POST"&&url.pathname==="/api/onechat/start"){const b=await readBody(req);const out=onechatTurnSessions.start({...b,ownerId:req.uaiSecurity.auth.identityId});return send(res,202,{state:"SUCCESS",session:out});}
  if(req.method==="GET"&&url.pathname==="/api/onechat/session"){const out=onechatTurnSessions.get(String(url.searchParams.get("id")||""),{ownerId:req.uaiSecurity.auth.identityId,since:Number(url.searchParams.get("since")||0)});return send(res,out.state==="DENIED"?403:out.state==="UNAVAILABLE"?404:200,out);}
  if(req.method==="POST"&&url.pathname==="/api/onechat/stop"){const b=await readBody(req);const out=onechatTurnSessions.cancel(String(b.id||""),{ownerId:req.uaiSecurity.auth.identityId});return send(res,out.state==="DENIED"?403:out.state==="UNAVAILABLE"?404:200,out);}
  if(req.method==="POST"&&url.pathname==="/api/onechat/resume"){const b=await readBody(req);const out=onechatTurnSessions.resume(String(b.id||""),{ownerId:req.uaiSecurity.auth.identityId});return send(res,out.state==="DENIED"?403:out.state==="UNAVAILABLE"?404:out.state==="BLOCKED"?409:200,out);}
  if(req.method==="GET"&&url.pathname==="/api/onechat/events"){
    const id=String(url.searchParams.get("id")||""),since=Number(url.searchParams.get("since")||0),initial=onechatTurnSessions.get(id,{ownerId:req.uaiSecurity.auth.identityId,since});
    if(initial.state!=="SUCCESS")return send(res,initial.state==="DENIED"?403:404,initial);
    res.writeHead(200,{"content-type":"text/event-stream; charset=utf-8","cache-control":"no-cache, no-store","connection":"keep-alive","x-accel-buffering":"no"});
    let cursor=since,closed=false;req.on("close",()=>{closed=true});
    const write=payload=>{if(closed)return;res.write(`data: ${JSON.stringify(payload)}\n\n`);};
    const pump=()=>{
      if(closed)return;
      const snap=onechatTurnSessions.get(id,{ownerId:req.uaiSecurity.auth.identityId,since:cursor});
      if(snap.state!=="SUCCESS"){write({type:"error",state:snap.state,message:snap.message});return res.end();}
      for(const e of snap.events){cursor=Math.max(cursor,e.seq||0);write(e);}
      const st=snap.session?.state;if(["SUCCESS","PARTIAL","FAILURE","ERROR","DENIED","BLOCKED","UNAVAILABLE","CANCELLED","TIMEOUT"].includes(st)){write({type:"done",state:st,session:snap.session});return res.end();}
      setTimeout(pump,250);
    };
    pump();return;
  }
  if(req.method==="POST"&&url.pathname==="/api/onechat"){const b=await readBody(req);return send(res,200,await onechat.handle({...b,ownerId:req.uaiSecurity.auth.identityId}));}
  if(req.method==="POST"&&url.pathname==="/api/chat"){const b=await readBody(req);return send(res,200,await onechat.handle({...b,ownerId:req.uaiSecurity.auth.identityId}));}
  if(req.method==="GET"){const rel=url.pathname==="/"?"index.html":url.pathname.slice(1);const fp=path.join(__dirname,"public",rel);if(fp.startsWith(path.join(__dirname,"public"))&&fs.existsSync(fp))return send(res,200,fs.readFileSync(fp),fp.endsWith(".html")?"text/html":"application/octet-stream");}
  send(res,404,{state:"FAILURE",message:"Not found.",requestId:res.getHeader("x-request-id")||null});
}catch(e){const requestId=res.getHeader("x-request-id")||`req-${crypto.randomUUID()}`;const status=Number(e?.statusCode)||500;const publicMessage=status===400?String(e?.message||"Invalid request."):"Internal server error";audit.append({type:"api.error",requestId,code:status,message:String(e?.message||e)});send(res,status,{state:"FAILURE",message:publicMessage,requestId,correlationId:res.getHeader("x-correlation-id")||requestId});}}
);
server.listen(PORT,HOST,()=>console.log(`IntraultUniversalion v${APP_VERSION} running at http://${HOST}:${PORT}`));
