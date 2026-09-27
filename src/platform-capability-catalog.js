const partial=[
"full-multimodal-ingestion","image-understanding","ocr-layout-aware-documents","audio-transcription","video-understanding",
"dense-embedding-backend","dense-reranking","complete-provenance-graph","production-os-kernel-plugin-isolation","federated-learning",
"multimodal-model-training","distillation-pipeline","large-scale-model-training","general-purpose-llm-parity","automatic-model-ensemble-orchestration",
"shadow-agent-research-population","light-agent-source-maintenance-population","multi-device-encrypted-sync","enterprise-identity-federation",
"full-ide-integration","full-repository-dependency-graph","large-scale-benchmark-leaderboard","energy-aware-scheduling",
"formal-governance-kernel-verification","self-hosted-model-marketplace","complete-offline-model-catalog","independent-trusted-device-bootstrap-proof"
];
export const MODEL_CATEGORIES=Object.freeze([
"small-local-chat","general-instruction","reasoning","coding","embedding","sparse-retrieval","dense-retrieval","reranker","vision-language",
"ocr","speech-to-text","text-to-speech","translation","classification","safety","tool-selection","planning","summarization","anomaly-detection",
"dataset-quality","code-verification","preference-reward"
]);
export const MODEL_RUNTIMES=Object.freeze([
"ForgeLM","llama.cpp","GGUF","Ollama","Transformers","PyTorch","ONNX Runtime","Safetensors","Hugging Face","MLX","TensorRT-LLM","vLLM",
"llama-cpp-python","WebGPU/WebAssembly","CPU-only fallback","Android/Termux","OpenAI-compatible API","Anthropic-compatible API",
"Google-compatible API","Azure-compatible API","local OpenAI-compatible server"
]);
export const LEARNING_METHODS=Object.freeze([
"causal-pretraining","supervised-fine-tuning","instruction-tuning","LoRA","QLoRA","DPO","RAG","continual-replay","regression-holdouts",
"tokenizer-training","dataset-provenance","source-approved-training","synthetic-verified-traces","inference-benchmarking","RLHF","RLAIF",
"constitutional-self-critique","knowledge-distillation","compression","quantization-aware-training","pruning","speculative-decoding","MoE-routing",
"contrastive-embedding","hard-negative-retrieval","cross-encoder-reranking","code-execution-feedback","test-driven-code-training","curriculum-learning",
"active-learning","uncertainty-sampling","disagreement-sampling","human-feedback-queues","multilingual-training","multimodal-alignment",
"federated-personalization","differential-privacy","secure-aggregation","adapter-composition","per-user-adapters","per-project-adapters",
"agent-trace-learning","tool-trajectory-learning","long-context-compression","memory-consolidation","deletion-aware-learning","drift-detection",
"model-rollback","model-canary-release"
]);
export const RETRIEVAL_LAYERS=Object.freeze([
"sqlite-fts5","sparse-semantic","dense-embeddings","metadata-filters","permission-filters","freshness-ranking","source-quality-ranking",
"query-rewriting","query-expansion","hybrid-retrieval","reranking","citation-verification","contradiction-detection","duplicate-removal",
"per-user-index","per-project-index","offline-index","multimodal-index","structured-data","code-symbol","graph","temporal"
]);
export const MEMORY_TYPES=Object.freeze(["working","session","conversation","task","user-semantic","user-episodic","project","agent","source","procedural","model-experiment","audit"]);
export const EVIDENCE_STATES=Object.freeze(["SUPPORTED","PARTIALLY_SUPPORTED","CONFLICTING","STALE","INFERRED","UNSUPPORTED","OPINION","UNVERIFIED"]);
export const PLUGIN_TYPES=Object.freeze([
"filesystem.read","filesystem.write","workspace.inspect","workspace.snapshot","workspace.rollback","shell.sandbox","code.search","code.symbols","code.test","code.build",
"code.format","code.security_scan","git.status","git.diff","git.branch","git.commit","git.patch","github.issues","github.pull_requests","github.code_search",
"github.actions","github.releases","web.search","web.fetch","web.extract","web.crawl","web.compare_sources","document.parse","document.ocr","document.chunk",
"document.index","document.delete","database.read","database.write","sqlite.query","sqlite.migrate","vector.embed","vector.search","vector.reindex","model.generate",
"model.embed","model.rerank","model.health","model.benchmark","model.train","model.adapter","model.rollback","image.inspect","image.generate","audio.transcribe",
"audio.synthesize","video.inspect","translation.translate","calendar.read","calendar.write","email.read","email.draft","email.send","tasks.create","tasks.update",
"notifications.local","termux.device","termux.storage","termux.camera","termux.microphone","simulation.run","shadow.spawn","shadow.evaluate","light.propose_patch",
"light.run_tests","light.rollback","audit.explain","policy.simulate","capability.probe"
]);
export const CONNECTOR_TYPES=Object.freeze({
development:["GitHub","GitLab","Bitbucket","Azure DevOps","Gitea","Gerrit","VS Code","JetBrains IDEs","Neovim","Emacs","local Git","CI/CD","Docker","Podman","Kubernetes","Terraform","package registries","vulnerability databases"],
research:["web search providers","Common Crawl","Wikipedia","arXiv","Crossref","Semantic Scholar","PubMed","OpenAlex","Hugging Face","Papers with Code","government data portals","RSS/Atom","library catalogs","licensed news"],
storage:["SQLite","PostgreSQL","DuckDB","Redis","object storage","local filesystem","S3-compatible storage","encrypted removable storage","local vector indexes","content-addressed artifact store"],
productivity:["local calendar","CalDAV","Google Calendar","Microsoft Graph Calendar","email","IMAP","SMTP","Slack","Discord","Matrix","Mattermost","Telegram","Signal-compatible local workflows","task managers","note systems","Nextcloud"],
device:["Termux","Android storage","camera","microphone","Bluetooth","serial devices","sensors","local notifications","desktop notifications","printer","local network discovery"]
});
export const TOOL_ABILITIES=Object.freeze([
"general-conversation","research-planning","multi-source-research","source-comparison","citation-generation","citation-verification","fact-extraction","contradiction-detection",
"code-generation","code-explanation","code-review","test-generation","test-execution","debugging","repository-mapping","dependency-analysis","security-scanning","performance-profiling",
"database-design","schema-migration","api-design","documentation-generation","translation","summarization","structured-extraction","table-analysis","spreadsheet-analysis",
"image-interpretation","ocr","audio-transcription","video-indexing","speech-interaction","personal-memory","project-memory","offline-operation","encrypted-synchronization",
"web-research","policy-checked-web-scraping","document-ingestion","rag-qa","model-training","model-adaptation","model-routing","model-benchmarking","plugin-discovery",
"plugin-certification","plugin-execution","plugin-rollback","shadow-research","shadow-simulation","shadow-evaluation","light-patching","light-testing","light-rollback",
"self-diagnostics","capability-probing","policy-simulation","approval-workflows","autonomy-leasing","resource-budgeting","incident-response","backup-restore",
"data-export","data-deletion","provenance-tracing","audit-explanation","safety-red-teaming","recovery-planning","multi-agent-debate","consensus-formation",
"uncertainty-estimation","human-escalation"
]);
export const RUNTIME_METRICS=Object.freeze(["request-latency","model-latency","first-token-latency","tokens-per-second","token-counts","memory-use","cpu-gpu-use","energy-use","retrieval-latency","plugin-latency","failure-rate","retry-rate","fallback-rate","cancellation-rate","approval-wait-time","task-completion-rate","recovery-success-rate","rollback-rate","quota-use"]);
export const QUALITY_METRICS=Object.freeze(["answer-accuracy","groundedness","citation-precision","citation-recall","retrieval-recall-at-k","retrieval-precision-at-k","MRR","nDCG","hallucination-rate","contradiction-rate","tool-call-accuracy","code-test-pass-rate","patch-acceptance-rate","refusal-accuracy","privacy-leakage-rate","prompt-injection-resistance","model-drift","regression-rate","human-preference-score"]);
export function platformCapabilityCatalog(){
  return {
    state:"SUCCESS",principle:"Independent AI operating environment with task-specific evidence; no universal-superiority claim.",
    differentiators:["local-ownership","evidence","reversibility","privacy","model-portability","self-improvement","independent-governance","offline-operation"],
    partialOrNotDemonstrated:partial.map(id=>({id,implementationState:"PARTIAL",availability:"UNAVAILABLE",claimableAsComplete:false})),
    modelCategories:MODEL_CATEGORIES,modelRuntimes:MODEL_RUNTIMES,learningMethods:LEARNING_METHODS,retrievalLayers:RETRIEVAL_LAYERS,
    memoryTypes:MEMORY_TYPES,evidenceStates:EVIDENCE_STATES,pluginTypes:PLUGIN_TYPES,connectors:CONNECTOR_TYPES,toolAbilities:TOOL_ABILITIES,
    metrics:{runtime:RUNTIME_METRICS,quality:QUALITY_METRICS},
    benchmarkTracks:["reasoning","coding","research","retrieval","citations","tool-use","autonomy-safety","privacy","offline-operation","latency","resource-consumption","self-improvement"]
  };
}
