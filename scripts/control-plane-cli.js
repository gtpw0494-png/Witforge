#!/usr/bin/env node
import path from "node:path";
import {AuditLog} from "../src/audit.js";
import {BoundedWorkerScheduler} from "../src/control-plane-scheduler.js";
import {ShadowCoordinator} from "../src/shadow/shadow-coordinator.js";
import {LightCoordinator} from "../src/light/light-coordinator.js";

const root=process.cwd(),stateRoot=path.resolve(process.env.IUV_STATE_DIR||path.join(root,"state")),audit=new AuditLog(stateRoot);
const scheduler=new BoundedWorkerScheduler({stateRoot,audit,maxWorkers:Number(process.env.IUV_AGENT_WORKERS||4),maxQueue:Number(process.env.IUV_AGENT_QUEUE||128),leaseMs:Number(process.env.IUV_AGENT_LEASE_MS||60000)});
const shadow=new ShadowCoordinator({stateRoot,audit,scheduler});
const light=new LightCoordinator({root,stateRoot,audit,scheduler});
const [cmd,...args]=process.argv.slice(2);
let out;
if(cmd==="jobs")out={state:"SUCCESS",jobs:scheduler.list({limit:Math.max(1,Math.min(1000,Number(args[0])||100)),queue:args[1]||null})};
else if(cmd==="dispatch"){
  const queue=String(args[0]||"").trim(),worker=String(args[1]||`termux-${queue||"worker"}`);
  if(queue==="shadow")out=await shadow.dispatchNext(worker);
  else if(queue==="light")out=await light.dispatchNext(worker);
  else out={state:"BLOCKED",message:"Usage: control-plane-cli.js dispatch <shadow|light> [workerId]"};
}else if(cmd==="maintenance"){
  const now=Date.now();out={state:"SUCCESS",shadow:shadow.maintenance(now),light:light.maintenance(now),scheduler:scheduler.status()};
}else out={state:"SUCCESS",scheduler:scheduler.status(),shadow:shadow.status(),light:light.status(),storage:scheduler.db.status()};
console.log(JSON.stringify(out,null,2));
