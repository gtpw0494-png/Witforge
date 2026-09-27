#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
const root=process.cwd(),required=[
  "server.js","package.json","package-lock.json","src/onechat.js","src/governance/authorization.js","src/governance/request-schemas.js",
  "src/shadow/shadow-coordinator.js","src/light/light-coordinator.js","src/memory/memory-store.js","src/provenance/graph.js",
  "storage/control_plane.py","storage/platform_state.py","governance/feature-evidence.json","requirements/runtime-matrix.json"
];
const missing=required.filter(p=>!fs.existsSync(path.join(root,p)));
const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
const bootstrapRefs=Object.entries(pkg.scripts||{}).filter(([name,cmd])=>/bootstrap|expand.*source|source.*expand/i.test(name+" "+cmd));
let tracked=[];try{tracked=execFileSync("git",["ls-files"],{cwd:root,encoding:"utf8"}).trim().split(/\n/).filter(Boolean);}catch{}
const untrackedRequired=required.filter(p=>tracked.length&&!tracked.includes(p));
const result={state:missing.length||untrackedRequired.length||bootstrapRefs.length?"FAILURE":"SUCCESS",missing,untrackedRequired,bootstrapScriptReferences:bootstrapRefs,trackedFiles:tracked.length,sourceTree:"ORDINARY_TRACKED_MAIN",bootstrapExpansionRequired:false};
console.log(JSON.stringify(result,null,2));if(result.state!=="SUCCESS")process.exit(1);
