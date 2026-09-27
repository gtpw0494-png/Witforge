#!/usr/bin/env node
import path from "node:path";
import {ShadowCoordinator} from "../src/shadow/shadow-coordinator.js";
import {AuditLog} from "../src/audit.js";
const root=process.cwd(),stateRoot=path.resolve(process.env.IUV_STATE_DIR||path.join(root,"state")),audit=new AuditLog(stateRoot),shadow=new ShadowCoordinator({stateRoot,audit});
const [cmd,...args]=process.argv.slice(2);
let out;
if(cmd==="agents")out={state:"SUCCESS",agents:shadow.registry.list()};
else if(cmd==="runs")out={state:"SUCCESS",runs:shadow.runs.list({limit:100})};
else if(cmd==="candidates")out={state:"SUCCESS",candidates:shadow.candidates.list(100)};
else if(cmd==="submit")out=shadow.submit({agentType:args.shift()||"research-discovery",objective:args.join(" ")});
else out=shadow.status();
console.log(JSON.stringify(out,null,2));
