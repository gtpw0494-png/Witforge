import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const existsCmd=cmd=>{const r=spawnSync('sh',['-lc',`command -v ${JSON.stringify(cmd)} >/dev/null 2>&1`]);return r.status===0;};
export class ModelRegistry{
 constructor(){this.file=path.join(root,'research','model_registry.json');}
 data(){return JSON.parse(fs.readFileSync(this.file,'utf8'));} list(){return this.data().models;}
 status(){const py=(name)=>spawnSync(process.env.PYTHON||'python3',['-c',`import importlib.util;print(bool(importlib.util.find_spec('${name}')))`],{encoding:'utf8'}).stdout?.trim()==='True';return {state:'SUCCESS',models:this.list(),runtimes:{forgelm:{availability:fs.existsSync(path.join(root,'model','forgelm.py'))?'REGISTERED_SOURCE':'UNAVAILABLE'},llamacpp:{availability:(existsCmd('llama-server')||existsCmd('llama')||existsCmd('llama-cli'))?'CONNECTED':'UNAVAILABLE'},ollama:{availability:existsCmd('ollama')?'CONNECTED':'UNAVAILABLE'},transformers:{availability:py('transformers')?'CONNECTED':'UNAVAILABLE'},onnxruntime:{availability:py('onnxruntime')?'CONNECTED':'UNAVAILABLE'}}};}
}
