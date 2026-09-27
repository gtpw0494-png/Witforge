import {spawnSync} from "node:child_process";import path from "node:path";import {fileURLToPath} from "node:url";
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export function dependencyStatus(){const r=spawnSync(process.env.PYTHON||"python3",[path.join(root,"model","dependency_status.py")],{encoding:"utf8",timeout:12000});if(r.error)return {state:"UNAVAILABLE",message:r.error.message,dependencies:{}};try{return JSON.parse(r.stdout.trim())}catch{return {state:"ERROR",message:(r.stderr||r.stdout).slice(0,1000),dependencies:{}}}}
