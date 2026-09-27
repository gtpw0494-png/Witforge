export class BenchmarkRunner{
  constructor({evaluationStore,audit=null}={}){this.evaluations=evaluationStore;this.audit=audit;}
  async run({subjectId,subjectType="model",category,benchmark,cases=[],execute,metric="successRate",evidence=[]}={}){
    if(typeof execute!=="function")return {state:"BLOCKED",message:"Benchmark execution callback is required."};const results=[];let passed=0;
    for(let i=0;i<cases.length;i++){const c=cases[i];let out;try{out=await execute(c,i);}catch(e){out={state:"ERROR",message:String(e.message||e)};}const ok=out?.state==="SUCCESS"&&(c?.expect===undefined||out?.value===c.expect);if(ok)passed++;results.push({index:i,state:out?.state||"UNKNOWN",passed:ok});}
    const metrics={[metric]:cases.length?passed/cases.length:0,cases:cases.length,passed};const rec=this.evaluations.record({subjectId,subjectType,category,benchmark,metrics,evidence:[...evidence,{type:"benchmark-results",results}],verified:cases.length>0});
    this.audit?.append({type:"benchmark.completed",subjectId,category,benchmark,metrics});return {...rec,metrics,results};
  }
}
