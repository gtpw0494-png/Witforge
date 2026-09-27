import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),dest=path.join(root,'vendor','puter'),commit='922d203e18e1946c83dca2fe3b179010fde0480c';
fs.mkdirSync(path.dirname(dest),{recursive:true});
if(!fs.existsSync(path.join(dest,'.git'))){const c=spawnSync('git',['clone','https://github.com/HeyPuter/puter.git',dest],{stdio:'inherit'});if(c.status!==0)process.exit(c.status||1);}
const f=spawnSync('git',['-C',dest,'fetch','--depth','1','origin',commit],{stdio:'inherit'});if(f.status!==0)process.exit(f.status||1);
const x=spawnSync('git',['-C',dest,'checkout','--detach',commit],{stdio:'inherit'});if(x.status!==0)process.exit(x.status||1);
console.log(JSON.stringify({state:'SUCCESS',path:dest,commit}));