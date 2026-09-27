#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {nodeChildEnv} from "../src/process-compat.js";

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const target=path.join(root,"public","app.js");
const r=spawnSync(process.execPath,["--check",target],{encoding:"utf8",timeout:30000,env:nodeChildEnv()});
if(r.status!==0){
  process.stderr.write((r.stderr||r.stdout||r.error?.message||"browser syntax check failed")+"\n");
  process.exit(r.status??1);
}
console.log("browser JavaScript syntax: ok");
