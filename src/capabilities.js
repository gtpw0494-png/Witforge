import {buildSourceResearchCapabilities} from "./source-capabilities.js";
export function buildCapabilityRegistry(providerHub,extras={}){
  const model=extras.model||{},vision=extras.vision||{},audio=extras.audio||{},speech=extras.speech||{},video=extras.video||{},multimodal=extras.multimodal||{},deps=extras.deps?.dependencies||{},langgraph=extras.langgraph||{},runtime=extras.runtimeServices||{};
  const modelReady=model.state==="SUCCESS"&&model.checkpointExists===true;
  const service=(name,fallback)=>runtime?.[name]||fallback;
  const billing=service("billing",{availability:"UNAVAILABLE",executable:false,reason:"Live billing adapter has not been probed."});
  const oxford=service("oxford",{availability:"UNAVAILABLE",executable:false,reason:"Oxford API adapter has not been configured."});
  const fabrication=service("fabrication",{availability:"UNAVAILABLE",executable:false,reason:"No verified physical fabrication controller is connected."});
  const base=[
    {id:"local.onechat",availability:"CONNECTED",executable:true},
    {id:"local.onechat.durable_sessions",availability:"CONNECTED",executable:true,reason:"Live OneChat turn snapshots and append-only event journals persist under local state and reconcile on restart.",constraints:["queued sessions may safely resume automatically","running sessions become INTERRUPTED after restart","interrupted work requires explicit owner resume","late results are never promoted after cancellation/interruption"]},
    {id:"local.release.integrity",availability:"CONNECTED",executable:true,reason:"Shipped source/support files are bound to a SHA-256 release manifest."},
    {id:"local.hardware.profile",availability:"CONNECTED",executable:true,reason:"Reports local CPU/RAM/Torch/CUDA facts and conservative preset candidates."},
    {id:"local.agent.collaboration",availability:"CONNECTED",executable:true},
    {id:"local.knowledge.read",availability:"CONNECTED",executable:true},
    {id:"local.knowledge.write",availability:"CONNECTED",executable:true},
    {id:"local.knowledge.binary.export",availability:"CONNECTED",executable:true},
    {id:"local.knowledge.binary.import",availability:"CONNECTED",executable:true},
    {id:"local.source.registry",availability:"CONNECTED",executable:true},
    {id:"local.web.registry",availability:"CONNECTED",executable:true,reason:"Governed registry for bulk/open web corpus sources."},
    {id:"local.web.url_ingest",availability:"CONNECTED",executable:true,reason:"Direct public http/https ingestion with robots check, private-network blocking, provenance and license state."},
    {id:"local.web.bulk_import",availability:"CONNECTED",executable:true,reason:"Streaming importers for Common Crawl WET, Wikimedia XML, Stack Exchange XML and FineWeb-style JSONL; Parquet requires optional pyarrow."},
    {id:"local.learning.verified_export",availability:"CONNECTED",executable:true},
    {id:"local.forgelm.architecture",availability:"CONNECTED",executable:true,reason:"Original local ForgeLM source is present."},
    {id:"local.forgelm.dataset.v2",availability:"CONNECTED",executable:true,reason:"Verified-trace + license-gated web dataset builder with provenance, deduplication, deterministic splits and hashes."},
    {id:"local.web.training_bridge",availability:"CONNECTED",executable:true,reason:"Only web records explicitly marked trainingEligible=true enter ForgeLM dataset construction."},
    {id:"local.forgelm.trainer.v2",availability:model.state==="SUCCESS"?"CONNECTED":"UNAVAILABLE",executable:model.state==="SUCCESS",reason:model.state==="SUCCESS"?"ForgeLM trainer is backed by the detected PyTorch runtime.":"Install the official Termux python-torch package or another compatible PyTorch runtime."},
    {id:"local.source.snapshot",availability:"CONNECTED",executable:true,reason:"Records locally fetched reference repo commits and license-file hashes."},
    {id:"local.forgelm.infer",availability:modelReady?"CONNECTED":"UNAVAILABLE",executable:modelReady,reason:modelReady?"Local checkpoint and neural runtime verified by ForgeLM status.":(model.message||"ForgeLM checkpoint/runtime unavailable.")},
    {id:"local.forgelm.token_stream",availability:modelReady?"CONNECTED":"UNAVAILABLE",executable:modelReady,reason:modelReady?"ForgeLM emits decoded text updates from the local sampling loop and supports cancellation through the same subprocess.":"Requires a promoted local ForgeLM checkpoint.",constraints:["true generation-time token callbacks","SSE transports emitted model updates","no token-stream claim for runtimes that do not emit token events"]},
    {id:"local.forgelm.embeddings",availability:modelReady?"CONNECTED":"UNAVAILABLE",executable:modelReady,reason:modelReady?"ForgeLM hidden-state embeddings execute locally from the promoted checkpoint.":"Requires a promoted local ForgeLM checkpoint."},
    {id:"local.forgelm.rerank",availability:modelReady?"CONNECTED":"UNAVAILABLE",executable:modelReady,reason:modelReady?"ForgeLM cosine reranking executes locally using native embeddings.":"Requires a promoted local ForgeLM checkpoint."},
    {id:"local.forgelm.long_context",availability:modelReady?"CONNECTED":"UNAVAILABLE",executable:modelReady,reason:modelReady?"ForgeLM-native chunking, dense retrieval and bounded context assembly are available offline.":"Requires a promoted local ForgeLM checkpoint.",constraints:["retrieval memory extends usable source context","active transformer attention remains bounded by checkpoint configuration","no external model fallback"]},
    {id:"local.forgevision.architecture",availability:"CONNECTED",executable:true,reason:"Trainable native visual patch encoder and ForgeLM-space projector are present in local source."},
    {id:"local.forgevision.train",availability:model.state==="SUCCESS"?"CONNECTED":"UNAVAILABLE",executable:model.state==="SUCCESS",reason:model.state==="SUCCESS"?"ForgeVision alignment training can run locally against ForgeLM text embeddings.":"Training requires a working local PyTorch runtime.",constraints:["image-caption data required","candidate checkpoint only","evaluation and explicit promotion required"]},
    {id:"local.forgevision.semantic_infer",availability:vision.state==="CONNECTED"?"CONNECTED":(vision.checkpointExists?"CONFIGURED":"UNAVAILABLE"),executable:vision.state==="CONNECTED",reason:vision.message||"No promoted/evaluated ForgeVision runtime is connected.",constraints:["promoted ForgeVision checkpoint required","promoted ForgeLM checkpoint required","local runtime health check required","no external model fallback"]},
    {id:"local.forgeaudio.architecture",availability:"CONNECTED",executable:true,reason:"Trainable local spectral audio encoder and ForgeLM-space projector are present."},
    {id:"local.forgeaudio.train",availability:model.state==="SUCCESS"?"CONNECTED":"UNAVAILABLE",executable:model.state==="SUCCESS",reason:model.state==="SUCCESS"?"ForgeAudio alignment training can run locally against ForgeLM text embeddings.":"Training requires a working local PyTorch runtime.",constraints:["PCM WAV audio-text data required","candidate checkpoint only","evaluation and explicit promotion required"]},
    {id:"local.forgeaudio.semantic_infer",availability:audio.state==="CONNECTED"?"CONNECTED":(audio.audioCheckpointExists?"CONFIGURED":"UNAVAILABLE"),executable:audio.state==="CONNECTED",reason:audio.message||"No promoted/evaluated ForgeAudio runtime is connected.",constraints:["promoted ForgeAudio checkpoint required","promoted ForgeLM checkpoint required","local runtime health check required","no external model fallback"]},
    {id:"local.forgespeech.architecture",availability:"CONNECTED",executable:true,reason:"Trainable ForgeLM-conditioned local waveform generator is present."},
    {id:"local.forgespeech.train",availability:model.state==="SUCCESS"?"CONNECTED":"UNAVAILABLE",executable:model.state==="SUCCESS",reason:model.state==="SUCCESS"?"ForgeSpeech can train locally from text/WAV pairs.":"Training requires a working local PyTorch runtime.",constraints:["local text/WAV data required","candidate checkpoint only","evaluation and explicit promotion required"]},
    {id:"local.forgespeech.synthesize",availability:speech.state==="CONNECTED"?"CONNECTED":(speech.speechCheckpointExists?"CONFIGURED":"UNAVAILABLE"),executable:speech.state==="CONNECTED",reason:speech.message||"No promoted/evaluated ForgeSpeech runtime is connected.",constraints:["promoted ForgeSpeech checkpoint required","promoted ForgeLM checkpoint required","local runtime health check required","no external TTS fallback"]},
    {id:"local.forgevideo.architecture",availability:"CONNECTED",executable:true,reason:"Trainable local frame encoder plus temporal transformer is present."},
    {id:"local.forgevideo.train",availability:model.state==="SUCCESS"?"CONNECTED":"UNAVAILABLE",executable:model.state==="SUCCESS",reason:model.state==="SUCCESS"?"ForgeVideo alignment training can run locally against ForgeLM text embeddings.":"Training requires a working local PyTorch runtime.",constraints:["local video-text data required","ffmpeg frame extraction required","candidate checkpoint only","evaluation and explicit promotion required"]},
    {id:"local.forgevideo.semantic_infer",availability:video.state==="CONNECTED"?"CONNECTED":(video.videoCheckpointExists?"CONFIGURED":"UNAVAILABLE"),executable:video.state==="CONNECTED",reason:video.message||"No promoted/evaluated ForgeVideo runtime is connected.",constraints:["promoted ForgeVideo checkpoint required","promoted ForgeLM checkpoint required","local runtime health check required","no external video model fallback"]},
    {id:"local.forgemultimodal.fusion",availability:multimodal.state==="CONNECTED"?"CONNECTED":"UNAVAILABLE",executable:multimodal.state==="CONNECTED",reason:multimodal.message||"Unified ForgeMultimodal runtime is unavailable.",constraints:["ForgeLM checkpoint required","individual modality checkpoints remain independently truth-gated","parameter-free fusion assembler is default","no external AI fallback"]},
    {id:"local.forgelm.train",availability:model.state==="SUCCESS"?"CONNECTED":"UNAVAILABLE",executable:model.state==="SUCCESS",reason:model.state==="SUCCESS"?"Local neural training runtime verified.":"Training requires a working PyTorch runtime; Termux provides python-torch."},
    {id:"local.langgraph.orchestration",availability:langgraph.availability||"UNAVAILABLE",executable:langgraph.availability==="CONNECTED",reason:langgraph.reason||"Install @langchain/langgraph and @langchain/core; built-in OneChat orchestration remains available without it."},
    {id:"local.ui.serve",availability:"CONNECTED",executable:true},
    {id:"local.dev.propose",availability:"CONNECTED",executable:true},
    {id:"local.selfdev.sandbox",availability:"CONNECTED",executable:true,constraints:["isolated candidate workspace","syntax checks","repository tests","approval before promotion"]},
    {id:"local.code.inspect",availability:"CONNECTED",executable:true},
    {id:"local.code.snapshot",availability:"CONNECTED",executable:true},
    {id:"local.code.mutate",availability:"CONNECTED",executable:true,constraints:["explicit proposal approval","workspace-bound paths","snapshot before write","hash conflict check"]},
    {id:"local.code.rollback",availability:"CONNECTED",executable:true,constraints:["explicit approval"]},
    {id:"local.agent.spawn",availability:"CONNECTED",executable:true,constraints:["child capabilities cannot exceed parent capabilities"]},
    {id:"local.task.orchestrate",availability:"CONNECTED",executable:true},
    {id:"local.accounts.metadata",availability:"CONNECTED",executable:true,reason:"Non-secret local account metadata only."},
    {id:"local.subscriptions.metadata",availability:"CONNECTED",executable:true,reason:"User-recorded subscription metadata; independent of live billing."},
    {id:"local.plugins.registry",availability:"CONNECTED",executable:true},
    {id:"billing.live.read",availability:billing.availability||"UNAVAILABLE",executable:billing.availability==="CONNECTED",reason:billing.reason},
    {id:"reference.oxford.compare",availability:oxford.availability||"UNAVAILABLE",executable:oxford.availability==="CONNECTED",reason:oxford.reason},
    {id:"physical.matter.fabricate",availability:fabrication.availability||"UNAVAILABLE",executable:fabrication.availability==="CONNECTED",reason:fabrication.reason,constraints:["real connected printer/controller","explicit FABRICATION_ENABLE=1","approval before physical job command"]}
  ];
  const research=buildSourceResearchCapabilities(extras.sourceRegistry||[]);
  return [...base,...research];
}
