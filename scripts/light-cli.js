#!/usr/bin/env node
import path from "node:path";
import {LightCoordinator} from "../src/light/light-coordinator.js";
import {AuditLog} from "../src/audit.js";
const root=process.cwd(),stateRoot=path.resolve(process.env.IUV_STATE_DIR||path.join(root,"state")),audit=new AuditLog(stateRoot),light=new LightCoordinator({root,stateRoot,audit});
const [cmd,...args]=process.argv.slice(2);
let out;
if(cmd==="agents")out={state:"SUCCESS",agents:light.registry.list()};
else if(cmd==="patches")out={state:"SUCCESS",patches:light.list({limit:100})};
else if(cmd==="propose")out=light.propose({agentType:args.shift()||"test-repair",objective:args.join(" ")});
else out=light.status();
console.log(JSON.stringify(out,null,2));
