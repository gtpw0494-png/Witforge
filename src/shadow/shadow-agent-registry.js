import {shadowProfile as research} from "./research-agent.js";
import {shadowProfile as literature} from "./literature-agent.js";
import {shadowProfile as modelEvaluation} from "./model-evaluation-agent.js";
import {shadowProfile as datasetQuality} from "./dataset-quality-agent.js";
import {shadowProfile as retrieval} from "./retrieval-critic.js";
import {shadowProfile as safety} from "./safety-red-team-agent.js";
import {shadowProfile as architecture} from "./architecture-agent.js";
import {shadowProfile as experiment} from "./experiment-agent.js";
import {shadowProfile as synthesis} from "./synthesis-agent.js";
import {normalizeAgentBudget} from "../agent-budget.js";

export const SHADOW_PERMISSIONS=Object.freeze({
  readApprovedResearch:true,useLocalModels:true,useSimulatedTools:true,generateCandidatePlans:true,
  generateCandidateTrainingRecords:true,isolatedWorktrees:true,runTests:true,runBenchmarks:true,
  critiqueProductionOutputs:true,inspectApprovedTelemetry:true,
  writeScopes:["shadow-run","shadow-candidate","experiment","quarantine"],
  deniedScopes:["production-policy","production-deploy","protected-governance","direct-training-promotion","hidden-evaluation"]
});
const extras=[
["web-source-comparison","Web-source comparison agent"],["citation-verifier","Citation verifier"],["hallucination-critic","Hallucination critic"],
["prompt-injection-tester","Prompt-injection tester"],["plugin-security-tester","Plugin-security tester"],["performance-analyst","Performance analyst"],
["hardware-analyst","Hardware analyst"],["competitor-analysis","Competitor-analysis agent"],["synthetic-data","Synthetic-data agent"],
["preference-data","Preference-data agent"],["model-routing-evaluator","Model-routing evaluator"],["documentation-researcher","Documentation researcher"],
["patent-prior-art","Patent/prior-art research agent"],["ux-research","User-experience research agent"],["accessibility-research","Accessibility research agent"],
["legal-licensing","Legal/licensing research agent"],["privacy-impact","Privacy-impact analyst"],["failure-analysis","Failure-analysis agent"],
["recovery-strategy","Recovery-strategy agent"]
].map(([id,label])=>({id,label,capabilities:["research.read","candidate.generate"],risk:"low"}));
const base=[research,literature,modelEvaluation,datasetQuality,retrieval,safety,architecture,experiment,synthesis,...extras];
export class ShadowAgentRegistry{
  constructor(){this.map=new Map(base.map(x=>[x.id,Object.freeze({...x,permissions:SHADOW_PERMISSIONS,defaultBudget:normalizeAgentBudget({})})]));}
  list(){return [...this.map.values()].map(x=>({...x}));}
  get(id){return this.map.get(String(id||""))||null;}
  has(id){return this.map.has(String(id||""));}
}
