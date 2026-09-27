import {lightProfile as testRepair} from "./test-agent.js";
import {lightProfile as lint} from "./lint-agent.js";
import {lightProfile as typeContract} from "./type-contract-agent.js";
import {lightProfile as dependency} from "./dependency-agent.js";
import {lightProfile as security} from "./security-agent.js";
import {lightProfile as performance} from "./performance-agent.js";
import {lightProfile as bugRepair} from "./bug-repair-agent.js";
import {lightProfile as refactoring} from "./refactoring-agent.js";
import {lightProfile as documentation} from "./documentation-agent.js";
import {lightProfile as migration} from "./migration-agent.js";
import {lightProfile as regression} from "./regression-agent.js";
import {lightProfile as release} from "./release-agent.js";
import {lightProfile as rollback} from "./rollback-agent.js";
import {normalizeAgentBudget} from "../agent-budget.js";

export const LIGHT_RESTRICTIONS=Object.freeze([
  "isolated-worktree-only","no-direct-protected-main-commit","no-governance-rule-rewrite",
  "no-test-disabling","no-audit-deletion","no-permission-expansion","no-self-approval",
  "record-change-reason-tests-risk-dependencies-rollback-evidence","expire-abandoned-worktrees"
]);
const extras=[
["unit-test-generation","Unit-test generation agent"],["integration-test","Integration-test agent"],["license-audit","License audit agent"],
["memory-optimization","Memory optimization agent"],["api-schema","API schema agent"],["accessibility","Accessibility agent"],
["ui-consistency","UI consistency agent"],["termux-mobile","Termux/mobile optimization agent"],["model-benchmark","Model benchmark agent"],
["retrieval-tuning","Retrieval tuning agent"],["prompt-regression","Prompt regression agent"],["plugin-certification","Plugin certification agent"]
].map(([id,label])=>({id,label,capabilities:["workspace.inspect","code.test","candidate.patch"],risk:"medium"}));
const profiles=[testRepair,lint,typeContract,dependency,security,performance,bugRepair,refactoring,documentation,migration,regression,release,rollback,...extras];
export class LightAgentRegistry{
  constructor(){this.map=new Map(profiles.map(x=>[x.id,Object.freeze({...x,restrictions:LIGHT_RESTRICTIONS,defaultBudget:normalizeAgentBudget({runtimeMs:600000,pluginCalls:24,networkCalls:8})})]));}
  list(){return [...this.map.values()].map(x=>({...x}));}
  get(id){return this.map.get(String(id||""))||null;}
  has(id){return this.map.has(String(id||""));}
}
