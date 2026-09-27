import crypto from "node:crypto";
import {validateSchema} from "./schema-validator.js";
import {SandboxRunner} from "./sandbox-runner.js";
import {PluginSecretBroker} from "./plugin-secret-broker.js";
import {requestDigest} from "./idempotency-store.js";

const rank={low:0,medium:1,high:2,critical:3};
const stable=value=>Array.isArray(value)?`[${value.map(stable).join(",")}]`:value&&typeof value==="object"?`{${Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+stable(value[k])).join(",")}}`:JSON.stringify(value);
const sha=v=>crypto.createHash("sha256").update(typeof v==="string"?v:stable(v)).digest("hex");
const validName=x=>/^[a-zA-Z0-9._:-]{1,128}$/.test(String(x||""));

function legacyOperation(plugin){
  return {
    name:"execute",
    risk:plugin.risk||"high",
    external:(plugin.permissions?.network?.allow||[]).length>0,
    reversible:plugin.reversible===true,
    timeoutMs:plugin.timeoutMs||10000,
    inputSchema:{type:"object"},
    outputSchema:null,
    secrets:[],
    capabilities:plugin.capabilities||[],
    resourceLimits:plugin.resourceLimits||{}
  };
}

function collectUrls(value,out=[]){
  if(typeof value==="string"){
    try{const u=new URL(value);if(["http:","https:"].includes(u.protocol))out.push(u);}catch{}
  }else if(Array.isArray(value))for(const x of value)collectUrls(x,out);
  else if(value&&typeof value==="object")for(const x of Object.values(value))collectUrls(x,out);
  return out;
}

function hostAllowed(host,allow=[]){
  const h=String(host||"").toLowerCase();
  return (allow||[]).some(rule=>{
    const r=String(rule||"").toLowerCase().trim();
    if(!r)return false;
    if(r.startsWith("*."))return h.endsWith(r.slice(1))&&h!==r.slice(2);
    return h===r;
  });
}

export class PluginGateway{
  constructor({registry,policyEngine,approvalStore=null,autonomyStore=null,idempotencyStore=null,capabilityStatus=null,secretBroker=null,sandboxRunner=null,audit=null}={}){
    Object.assign(this,{registry,policyEngine,approvalStore,autonomyStore,idempotencyStore,capabilityStatus,audit});
    this.secretBroker=secretBroker||new PluginSecretBroker();
    this.sandboxRunner=sandboxRunner||new SandboxRunner({audit});
  }

  operation(plugin,name="execute"){
    const ops=Array.isArray(plugin.operations)&&plugin.operations.length?plugin.operations:[legacyOperation(plugin)];
    return ops.find(x=>x.name===name)||null;
  }

  async _capabilities(required=[]){
    if(!required.length)return {state:"SUCCESS",required:[],evidence:[]};
    if(!this.capabilityStatus)return {state:"UNAVAILABLE",message:"Capability evidence provider is not configured.",required};
    const rows=await this.capabilityStatus();
    const list=Array.isArray(rows)?rows:(rows?.capabilities||rows?.entries||[]);
    const evidence=required.map(id=>list.find(x=>x.id===id)||{id,availability:"UNAVAILABLE",executable:false,reason:"No capability evidence found."});
    const missing=evidence.filter(x=>x.availability!=="CONNECTED"||x.executable!==true);
    return missing.length?{state:"UNAVAILABLE",message:"Required plugin capability is not executable.",required,evidence,missing}:{state:"SUCCESS",required,evidence};
  }

  async execute(pluginId,operationName="execute",input={},options={}){
    const plugin=this.registry?.get(pluginId);
    if(!plugin)return {state:"FAILURE",message:"Plugin not found."};
    const status=this.registry.executionStatus(pluginId);
    if(status.state!=="CONFIGURED")return status;
    const operation=this.operation(plugin,operationName);
    if(!operation)return {state:"BLOCKED",message:"Plugin operation is not declared.",pluginId,operation:operationName};
    if(!validName(operation.name))return {state:"BLOCKED",message:"Plugin operation name is invalid."};

    const inputCheck=validateSchema(operation.inputSchema||{type:"object"},input);
    if(inputCheck.state!=="SUCCESS")return {state:"BLOCKED",message:"Plugin input failed schema validation.",validation:inputCheck};

    const allow=plugin.permissions?.network?.allow||[];
    const urls=collectUrls(input);
    const deniedUrls=urls.filter(u=>!hostAllowed(u.hostname,allow));
    if(deniedUrls.length)return {state:"DENIED",message:"Plugin input references a network destination outside the manifest allowlist.",hosts:[...new Set(deniedUrls.map(x=>x.hostname))]};

    const secretResolution=this.secretBroker.resolve(plugin.permissions?.secrets||[],operation.secrets||[]);
    if(secretResolution.state!=="SUCCESS")return secretResolution;

    const required=[...new Set([...(plugin.requiresCapabilities||[]),...(operation.requiresCapabilities||[])])];
    const capability=await this._capabilities(required);
    if(capability.state!=="SUCCESS")return capability;

    const risk=String(operation.risk||plugin.risk||"high").toLowerCase();
    const bindingArgs={pluginId,manifestDigest:plugin.manifestDigest,operation:operation.name,inputSha256:sha(input)};
    const policy=this.policyEngine?.evaluate({
      operation:"plugin."+operation.name,
      risk,
      external:Boolean(operation.external||allow.length),
      requiresCredential:(operation.secrets||[]).length>0
    })||{decision:"ASK",reason:"No policy engine configured."};

    if(policy.decision!=="ALLOW"){
      const expected={operation:"plugin."+operation.name,arguments:bindingArgs,capability:"plugin."+operation.name,actor:"user:onechat",toolVersion:plugin.version,actionEnvelopeId:options.actionEnvelopeId||null,taskId:options.taskId||null};
      if(!options.approvalId){
        return {state:policy.decision==="ESCALATE"?"ESCALATED":"ASK",message:"Exact plugin invocation approval is required.",policy,approval:null,binding:expected};
      }
      const approval=this.approvalStore?.validate(options.approvalId,expected);
      if(!approval||approval.state!=="SUCCESS"){
        return {state:policy.decision==="ESCALATE"?"ESCALATED":"ASK",message:"Exact plugin invocation approval is required.",policy,approval:approval||null,binding:expected};
      }
    }

    const idemRequired=operation.idempotencyRequired===true||operation.external===true||rank[risk]>=rank.high||operation.reversible===false;
    if(idemRequired&&!options.idempotencyKey)return {state:"BLOCKED",message:"This plugin operation requires an Idempotency-Key."};
    if(idemRequired&&!this.idempotencyStore)return {state:"UNAVAILABLE",message:"Idempotency persistence is required but not configured."};
    const requestHash=requestDigest({pluginId,manifestDigest:plugin.manifestDigest,operation:operation.name,input});
    if(options.idempotencyKey&&this.idempotencyStore){
      const existing=this.idempotencyStore.get(options.idempotencyKey);
      if(existing&&Date.parse(existing.expiresAt||0)>Date.now()){
        if(existing.operation!=="plugin."+operation.name||existing.requestHash!==requestHash)return {state:"DENIED",message:"Idempotency key was already used for a different request.",record:existing};
        if(existing.status==="COMPLETED")return {...existing.result,idempotentReplay:true,idempotencyKey:String(options.idempotencyKey)};
        return {state:"BLOCKED",message:"An identical request with this idempotency key is already in progress or already failed.",record:existing};
      }
    }

    if(options.autonomyLeaseId&&policy.decision==="ALLOW"){
      const lease=this.autonomyStore?.authorize(options.autonomyLeaseId,{operation:"plugin."+operation.name,risk});
      if(!lease||lease.state!=="SUCCESS")return {state:"DENIED",message:"Autonomy lease does not authorize this invocation.",lease:lease||null,policy};
    }

    const idem=this.idempotencyStore?.begin(options.idempotencyKey,{operation:"plugin."+operation.name,requestHash,ttlMs:operation.idempotencyTtlMs||86400000});
    if(idem?.state==="DENIED"||idem?.state==="BLOCKED")return idem;
    if(idem?.state==="REPLAY")return {...idem.result,idempotentReplay:true,idempotencyKey:String(options.idempotencyKey)};

    const invocationId="plugin-inv-"+crypto.randomUUID();
    this.audit?.append({type:"plugin.gateway.begin",invocationId,pluginId,operation:operation.name,risk,policyDecision:policy.decision,capabilities:required,secretNames:secretResolution.names||[],idempotencyKeyHash:options.idempotencyKey?sha(String(options.idempotencyKey)):null});

    const result=await this.sandboxRunner.run({plugin,operation,input,secrets:secretResolution.values||{},signal:options.signal||null,invocationId});
    if(result.state==="SUCCESS"&&operation.outputSchema){
      const outputCheck=validateSchema(operation.outputSchema,result.result);
      if(outputCheck.state!=="SUCCESS"){
        const blocked={state:"BLOCKED",message:"Plugin output failed schema validation.",validation:outputCheck,invocationId};
        if(options.idempotencyKey&&this.idempotencyStore)this.idempotencyStore.fail(options.idempotencyKey,blocked);
        this.audit?.append({type:"plugin.gateway.verify",invocationId,pluginId,operation:operation.name,state:"BLOCKED",reason:"output-schema"});
        return blocked;
      }
    }

    if(options.idempotencyKey&&this.idempotencyStore){
      if(result.state==="SUCCESS")this.idempotencyStore.complete(options.idempotencyKey,result);
      else this.idempotencyStore.fail(options.idempotencyKey,result);
    }
    this.audit?.append({type:"plugin.gateway.finish",invocationId,pluginId,operation:operation.name,state:result.state});
    return {...result,pluginId,operation:operation.name,policy,capabilityEvidence:capability.evidence||[]};
  }
}
