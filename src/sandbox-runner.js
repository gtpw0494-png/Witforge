import {spawn} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {redactSecretValues} from "./plugin-secret-broker.js";

const safeJson=v=>JSON.stringify(v??null);
const cleanScope=x=>String(x||"").trim().replace(/[\r\n\0]/g,"");

export class SandboxRunner{
  constructor({command=null,audit=null}={}){
    this.command=command;
    this.audit=audit;
  }

  configured(){return Boolean(String(this.command||process.env.IUV_PLUGIN_SANDBOX_COMMAND||"").trim());}

  async run({plugin,operation,input,secrets={},signal=null,invocationId=null}={}){
    const cmd=String(this.command||process.env.IUV_PLUGIN_SANDBOX_COMMAND||"").trim();
    if(!cmd)return {state:"UNAVAILABLE",message:"Plugin execution requires an explicitly configured sandbox command."};
    const resource={...(plugin.resourceLimits||{}),...(operation.resourceLimits||{})};
    const timeoutMs=Math.max(100,Math.min(300000,Number(operation.timeoutMs||plugin.timeoutMs||10000)));
    const maxOutputBytes=Math.max(1024,Math.min(10_000_000,Number(resource.maxOutputBytes||100000)));
    const tempHome=fs.mkdtempSync(path.join(os.tmpdir(),"uai-plugin-"));
    const env={
      PATH:process.env.PATH||"",
      HOME:tempHome,
      TMPDIR:tempHome,
      IUV_PLUGIN_ID:plugin.id,
      IUV_PLUGIN_VERSION:String(plugin.version||""),
      IUV_PLUGIN_ENTRYPOINT:plugin.entrypoint,
      IUV_PLUGIN_MANIFEST_DIGEST:plugin.manifestDigest,
      IUV_PLUGIN_OPERATION:operation.name,
      IUV_PLUGIN_NETWORK_ALLOW:safeJson(plugin.permissions?.network?.allow||[]),
      IUV_PLUGIN_FILESYSTEM_READ:safeJson(plugin.permissions?.filesystem?.read||[]),
      IUV_PLUGIN_FILESYSTEM_WRITE:safeJson(plugin.permissions?.filesystem?.write||[]),
      IUV_PLUGIN_PROCESS_SPAWN:String(plugin.permissions?.process?.spawn===true),
      IUV_PLUGIN_CPU_MS:String(resource.cpuMs||0),
      IUV_PLUGIN_MEMORY_MB:String(resource.memoryMb||0),
      IUV_PLUGIN_MAX_OUTPUT_BYTES:String(maxOutputBytes),
      IUV_PLUGIN_INVOCATION_ID:String(invocationId||"")
    };
    for(const [name,value] of Object.entries(secrets))env["IUV_SECRET_"+cleanScope(name).toUpperCase().replace(/[^A-Z0-9_]/g,"_")]=value;

    return await new Promise(resolve=>{
      let settled=false,out="",err="",bytes=0,child=null;
      const cleanup=()=>{try{fs.rmSync(tempHome,{recursive:true,force:true});}catch{}};
      const finish=result=>{
        if(settled)return;
        settled=true;
        clearTimeout(timer);
        signal?.removeEventListener?.("abort",onAbort);
        cleanup();
        resolve(redactSecretValues(result,secrets));
      };
      const killWith=(state,message)=>{
        try{child?.kill("SIGKILL");}catch{}
        finish({state,message,invocationId});
      };
      const onAbort=()=>killWith("CANCELLED","Plugin invocation cancelled.");
      if(signal?.aborted){cleanup();return resolve({state:"CANCELLED",message:"Plugin invocation cancelled before execution.",invocationId});}
      try{
        child=spawn("sh",["-lc",cmd],{env,stdio:["pipe","pipe","pipe"],cwd:tempHome});
      }catch(e){cleanup();return resolve({state:"UNAVAILABLE",message:e.message,invocationId});}
      const timer=setTimeout(()=>killWith("TIMEOUT","Plugin sandbox timeout."),timeoutMs);
      signal?.addEventListener?.("abort",onAbort,{once:true});
      const capture=(kind,d)=>{
        const b=Buffer.from(d);bytes+=b.length;
        if(bytes>maxOutputBytes)return killWith("BLOCKED","Plugin output exceeded the declared output limit.");
        if(kind==="out")out+=b.toString("utf8");else err+=b.toString("utf8");
      };
      child.stdout.on("data",d=>capture("out",d));
      child.stderr.on("data",d=>capture("err",d));
      child.on("error",e=>finish({state:"UNAVAILABLE",message:e.message,invocationId}));
      child.on("close",code=>{
        if(settled)return;
        let parsed=null;try{parsed=JSON.parse(out.trim());}catch{}
        const state=code===0?"SUCCESS":"FAILURE";
        this.audit?.append({type:"plugin.sandbox.complete",pluginId:plugin.id,operation:operation.name,state,code,invocationId,bytes});
        finish({state,message:state==="SUCCESS"?"Plugin sandbox completed.":"Plugin sandbox failed.",code,result:parsed,stdout:parsed?undefined:out,stderr:err,invocationId,bytes});
      });
      child.stdin.end(JSON.stringify({plugin:{id:plugin.id,version:plugin.version,entrypoint:plugin.entrypoint,manifestDigest:plugin.manifestDigest},operation:operation.name,input}));
    });
  }
}
