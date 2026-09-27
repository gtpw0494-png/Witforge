import {spawn} from "node:child_process";
import crypto from "node:crypto";
import {requestDigest} from "./idempotency-store.js";

export class PluginExecutor{
  constructor({registry,approvalStore,policyEngine,idempotencyStore=null,audit=null}={}){
    Object.assign(this,{registry,approvalStore,policyEngine,idempotencyStore,audit});
  }

  async execute(pluginId,input={},approvalId=null,idempotencyKey=null){
    const st=this.registry?.executionStatus(pluginId);
    if(!st||st.state!=="CONFIGURED")return st||{state:"UNAVAILABLE",message:"Plugin registry unavailable."};

    const p=st.plugin;
    const operation="plugin.execute";
    const inputSha256=crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const args={pluginId,manifestDigest:p.manifestDigest,inputSha256};
    const policy=this.policyEngine?.evaluate({
      operation,
      risk:p.risk||"high",
      external:(p.permissions?.network?.allow||[]).length>0,
      requiresCredential:false
    })||{decision:"ASK",reason:"Plugin execution requires explicit approval."};

    if(policy.decision!=="ALLOW"){
      const v=this.approvalStore?.validate(approvalId,{
        operation,
        arguments:args,
        capability:operation,
        actor:"user:onechat",
        toolVersion:p.version,
        actionEnvelopeId:null,
        taskId:null
      });
      if(!v||v.state!=="SUCCESS"){
        return {
          state:policy.decision==="ESCALATE"?"ESCALATED":"ASK",
          message:"Exact plugin invocation approval is required.",
          policy,
          approval:v||null,
          binding:{operation,arguments:args,capability:operation,actor:"user:onechat",toolVersion:p.version}
        };
      }
    }

    const requestHash=requestDigest({pluginId,manifestDigest:p.manifestDigest,input});
    const idem=this.idempotencyStore?.begin(idempotencyKey,{operation,requestHash});
    if(idem?.state==="DENIED"||idem?.state==="BLOCKED")return idem;
    if(idem?.state==="REPLAY"){
      return {...idem.result,idempotentReplay:true,idempotencyKey:String(idempotencyKey)};
    }

    const cmd=String(process.env.IUV_PLUGIN_SANDBOX_COMMAND||"").trim();
    return await new Promise(resolve=>{
      let settled=false;
      const finish=result=>{
        if(settled)return;
        settled=true;
        if(idempotencyKey&&this.idempotencyStore)this.idempotencyStore.complete(idempotencyKey,result);
        resolve(result);
      };

      const child=spawn("sh",["-lc",cmd],{
        env:{
          PATH:process.env.PATH||"",
          HOME:process.env.HOME||"",
          IUV_PLUGIN_ID:p.id,
          IUV_PLUGIN_ENTRYPOINT:p.entrypoint,
          IUV_PLUGIN_MANIFEST_DIGEST:p.manifestDigest
        },
        stdio:["pipe","pipe","pipe"]
      });

      let out="",err="";
      const timer=setTimeout(()=>{
        child.kill("SIGKILL");
        finish({state:"TIMEOUT",message:"Plugin sandbox timeout."});
      },Math.min(Number(p.timeoutMs)||10000,300000));

      child.stdout.on("data",d=>out+=d);
      child.stderr.on("data",d=>err+=d);
      child.on("error",e=>{
        clearTimeout(timer);
        finish({state:"UNAVAILABLE",message:e.message});
      });
      child.on("close",code=>{
        clearTimeout(timer);
        let parsed=null;try{parsed=JSON.parse(out.trim());}catch{}
        const state=code===0?"SUCCESS":"FAILURE";
        this.audit?.append({type:"plugin.execute",pluginId:p.id,manifestDigest:p.manifestDigest,state,code,idempotencyKeyHash:idempotencyKey?crypto.createHash("sha256").update(String(idempotencyKey)).digest("hex"):null});
        finish({
          state,
          message:state==="SUCCESS"?"Plugin sandbox completed.":"Plugin sandbox failed.",
          code,
          result:parsed,
          stdout:parsed?undefined:out.slice(0,4000),
          stderr:err.slice(0,4000)
        });
      });
      child.stdin.end(JSON.stringify({plugin:p,input}));
    });
  }
}
