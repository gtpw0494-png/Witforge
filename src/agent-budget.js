const n=(v,d)=>Number.isFinite(Number(v))?Number(v):d;
export const DEFAULT_AGENT_CEILINGS=Object.freeze({
  depth:4,concurrency:4,tokens:120000,memoryBytes:536870912,cpuMillis:900000,
  gpuMillis:900000,runtimeMs:900000,costUnits:100,pluginCalls:32,networkCalls:16
});
export function normalizeAgentBudget(input={},ceilings=DEFAULT_AGENT_CEILINGS){
  const out={};
  for(const [k,max] of Object.entries(ceilings))out[k]=Math.max(k==="depth"||k==="concurrency"||k.endsWith("Calls")?1:0,Math.min(max,n(input[k],max)));
  return Object.freeze(out);
}
export function zeroUsage(){return {depth:0,concurrency:0,tokens:0,memoryBytes:0,cpuMillis:0,gpuMillis:0,runtimeMs:0,costUnits:0,pluginCalls:0,networkCalls:0};}
export function checkBudget(budget,usage=zeroUsage(),delta={}){
  const next={...zeroUsage(),...usage};
  for(const k of Object.keys(next))next[k]=n(next[k],0)+n(delta[k],0);
  const exceeded=Object.entries(budget).filter(([k,max])=>n(next[k],0)>max).map(([k,max])=>({resource:k,used:next[k],limit:max}));
  return {state:exceeded.length?"BLOCKED":"SUCCESS",allowed:!exceeded.length,next,exceeded};
}
export function consumeBudget(budget,usage,delta){const r=checkBudget(budget,usage,delta);return r.allowed?r.next:usage;}
