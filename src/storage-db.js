import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function runExternal(rel,args,timeout=30000){return new Promise(resolve=>{const p=spawn(process.env.PYTHON||'python3',[path.join(root,rel),...args],{cwd:root});let out='',err='';const timer=setTimeout(()=>{p.kill('SIGKILL');resolve({state:'TIMEOUT',message:'Storage command timed out.'});},timeout);p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',e=>{clearTimeout(timer);resolve({state:'UNAVAILABLE',message:e.message});});p.on('close',code=>{clearTimeout(timer);if(code!==0)return resolve({state:'ERROR',message:(err||out||`Storage command exited ${code}`).slice(0,4000)});try{resolve(JSON.parse(out.trim().split(/\n/).filter(Boolean).at(-1)||'{}'));}catch{resolve({state:'ERROR',message:(err||out||'Invalid storage response').slice(0,4000)});}});});}
function run(args,timeout=30000){return new Promise(resolve=>{const p=spawn(process.env.PYTHON||'python3',[path.join(root,'storage','db.py'),...args],{cwd:root});let out='',err='';const timer=setTimeout(()=>{p.kill('SIGKILL');resolve({state:'TIMEOUT',message:'SQLite storage command timed out.'});},timeout);p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',e=>{clearTimeout(timer);resolve({state:'UNAVAILABLE',message:e.message});});p.on('close',code=>{clearTimeout(timer);if(code!==0)return resolve({state:'ERROR',message:(err||out||`Storage command exited ${code}`).slice(0,4000)});try{resolve(JSON.parse(out.trim().split(/\n/).filter(Boolean).at(-1)||'{}'));}catch{resolve({state:'ERROR',message:(err||out||'Invalid storage response').slice(0,4000)});}});});}
export class StorageDatabase{
 status(){return run(['status']);}
 init(){return run(['init']);}
 define(term,limit=8){return run(['define','--term',String(term),'--limit',String(limit)]);}
 related(term,relation='',limit=12){const a=['related','--term',String(term),'--limit',String(limit)];if(relation)a.push('--relation',String(relation));return run(a);}
 banter(query='',limit=8,style=''){const a=['banter','--query',String(query),'--limit',String(limit)];if(style)a.push('--style',String(style));return run(a);}
 semanticSearch(query,kind='all',limit=8){return runExternal('storage/semantic.py',['search','--query',String(query),'--kind',String(kind),'--limit',String(limit)],45000);}
 semanticBuild(){return runExternal('storage/semantic.py',['build'],120000);}
 lifecycleStatus(){return runExternal('storage/lifecycle.py',['status']);}
 retainSource(sourceId,days){return runExternal('storage/lifecycle.py',['retain','--source-id',String(sourceId),'--days',String(days)]);}
 deleteSource(sourceId,reason='user-requested deletion'){return runExternal('storage/lifecycle.py',['delete-source','--source-id',String(sourceId),'--reason',String(reason)]);}
 purgeSource(sourceId,reason='user-requested purge'){return runExternal('storage/lifecycle.py',['purge-source','--source-id',String(sourceId),'--reason',String(reason)]);}
}
