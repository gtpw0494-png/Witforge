import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {execFileSync} from "node:child_process";
import {PlatformStateStore} from "../platform-state-store.js";

const iso=()=>new Date().toISOString();
const sha=s=>crypto.createHash("sha256").update(String(s)).digest("hex");
const codeExt=new Set([".js",".mjs",".cjs",".ts",".tsx",".jsx",".py"]);
function language(file){const e=path.extname(file).toLowerCase();return e===".py"?"python":([".ts",".tsx"].includes(e)?"typescript":"javascript");}
function parseJs(text){
  const symbols=[],imports=[];
  for(const m of text.matchAll(/\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g))symbols.push({name:m[1],kind:"function",offset:m.index});
  for(const m of text.matchAll(/\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g))symbols.push({name:m[1],kind:"class",offset:m.index});
  for(const m of text.matchAll(/\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g))symbols.push({name:m[1],kind:"binding",offset:m.index});
  for(const m of text.matchAll(/(?:import[\s\S]*?from\s*|import\s*|require\s*\()\s*["']([^"']+)["']/g))imports.push(m[1]);
  return {symbols,imports};
}
function parsePy(text){
  const symbols=[],imports=[];
  for(const m of text.matchAll(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm))symbols.push({name:m[1],kind:"function",offset:m.index});
  for(const m of text.matchAll(/^\s*class\s+([A-Za-z_]\w*)\s*[:(]/gm))symbols.push({name:m[1],kind:"class",offset:m.index});
  for(const m of text.matchAll(/^\s*import\s+([^\n#]+)/gm))for(const x of m[1].split(",").map(x=>x.trim().split(/\s+as\s+/)[0]).filter(Boolean))imports.push(x);
  for(const m of text.matchAll(/^\s*from\s+([A-Za-z0-9_\.]+)\s+import\s+/gm))imports.push(m[1]);
  return {symbols,imports};
}
function lineAt(text,offset){return text.slice(0,Math.max(0,offset)).split("\n").length;}
function escapeRegex(text){return String(text).replace(/[.*+?^$(){}|[\]\\]/g,"\\$&");}

export class RepositoryIntelligence{
  constructor({root=process.cwd(),stateRoot=null,audit=null,maxFileBytes=2000000}={}){
    this.root=path.resolve(root);this.db=new PlatformStateStore(stateRoot);this.audit=audit;
    this.maxFileBytes=Math.max(65536,Math.min(20000000,Number(maxFileBytes)||2000000));
  }
  _files(){
    try{return execFileSync("git",["-C",this.root,"ls-files"],{encoding:"utf8",timeout:10000}).split(/\n/).filter(Boolean).filter(x=>codeExt.has(path.extname(x).toLowerCase()));}
    catch{
      const out=[];const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){if([".git","node_modules","state","runs","checkpoints"].includes(e.name))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p);else{const rel=path.relative(this.root,p);if(codeExt.has(path.extname(rel).toLowerCase()))out.push(rel);}}};walk(this.root);return out;
    }
  }
  _put(kind,record,event){
    const cur=this.db.get(kind,record.id);
    return cur.record?this.db.cas(kind,record.id,cur.version,record,{type:event||"reindex"}):this.db.create(kind,record);
  }
  clear(){
    const counts={};
    for(const kind of ["code-edge","code-symbol","code-file"]){let n=0;for(const x of this.db.list(kind,10000).records||[]){if(this.db.delete(kind,x.id,{type:"code.index.clear"}).state==="SUCCESS")n++;}counts[kind]=n;}
    return {state:"SUCCESS",deleted:counts};
  }
  reindex(){
    const files=this._files(),seen={files:new Set(),symbols:new Set(),edges:new Set()},now=iso();
    let fileCount=0,symbolCount=0,edgeCount=0,skipped=0;
    for(const rel of files){
      const abs=path.resolve(this.root,rel);if(!abs.startsWith(this.root+path.sep)||!fs.existsSync(abs))continue;
      const st=fs.statSync(abs);if(st.size>this.maxFileBytes){skipped++;continue;}
      const text=fs.readFileSync(abs,"utf8"),lang=language(rel),parsed=lang==="python"?parsePy(text):parseJs(text),fileId="code-file-"+sha(rel);
      const fileRec={id:fileId,subjectId:rel,path:rel,language:lang,sha256:sha(text),bytes:st.size,state:"ACTIVE",indexedAt:now,updatedAt:now};
      this._put("code-file",fileRec,"code.file.indexed");seen.files.add(fileId);fileCount++;
      for(const sym of parsed.symbols){
        const id="code-symbol-"+sha(rel+"|"+sym.kind+"|"+sym.name+"|"+sym.offset);
        const rec={id,subjectId:sym.name,sourceId:fileId,name:sym.name,kind:sym.kind,file:rel,line:lineAt(text,sym.offset),language:lang,state:"ACTIVE",indexedAt:now,updatedAt:now};
        this._put("code-symbol",rec,"code.symbol.indexed");seen.symbols.add(id);symbolCount++;
      }
      for(const spec of parsed.imports){
        const id="code-edge-"+sha(rel+"|imports|"+spec);
        const rec={id,subjectId:rel,sourceId:fileId,fromFile:rel,toSpecifier:spec,relation:"IMPORTS",state:"ACTIVE",indexedAt:now,updatedAt:now};
        this._put("code-edge",rec,"code.edge.indexed");seen.edges.add(id);edgeCount++;
      }
    }
    for(const pair of [["code-file",seen.files],["code-symbol",seen.symbols],["code-edge",seen.edges]])for(const x of this.db.list(pair[0],10000).records||[])if(!pair[1].has(x.id))this.db.delete(pair[0],x.id,{type:"code.index.stale"});
    const result={state:"SUCCESS",files:fileCount,symbols:symbolCount,edges:edgeCount,skipped,maxFileBytes:this.maxFileBytes,indexedAt:now};
    this.audit?.append({type:"code.index.rebuilt",files:fileCount,symbols:symbolCount,edges:edgeCount,skipped});return result;
  }
  status(){const s=this.db.status();return {state:"SUCCESS",files:s.counts?.["code-file"]||0,symbols:s.counts?.["code-symbol"]||0,edges:s.counts?.["code-edge"]||0,maxFileBytes:this.maxFileBytes};}
  symbols(query,{limit=50,kind=null,file=null}={}){
    const q=String(query||"").trim().toLowerCase();let rows=this.db.list("code-symbol",10000).records||[];
    if(q)rows=rows.filter(x=>x.name.toLowerCase().includes(q)||x.file.toLowerCase().includes(q));if(kind)rows=rows.filter(x=>x.kind===kind);if(file)rows=rows.filter(x=>x.file===file);
    return {state:rows.length?"SUCCESS":"UNAVAILABLE",query,results:rows.sort((a,b)=>a.name.localeCompare(b.name)||a.file.localeCompare(b.file)).slice(0,Math.max(1,Math.min(500,Number(limit)||50)))};
  }
  dependencies(file=null,{limit=500}={}){let rows=this.db.list("code-edge",10000).records||[];if(file)rows=rows.filter(x=>x.fromFile===file);return {state:"SUCCESS",file,edges:rows.slice(0,Math.max(1,Math.min(5000,Number(limit)||500)))};}
  file(rel){const rec=this.db.get("code-file","code-file-"+sha(String(rel))).record;return rec?{state:"SUCCESS",file:rec}:{state:"FAILURE",message:"Indexed code file not found."};}
  references(name,{limit=100}={}){
    const needle=String(name||"").trim();if(!needle)return {state:"BLOCKED",message:"symbol name required."};const refs=[],cap=Math.min(5000,Number(limit)||100),re=new RegExp("\\b"+escapeRegex(needle)+"\\b","g");
    for(const f of this.db.list("code-file",10000).records||[]){const abs=path.join(this.root,f.path);if(!fs.existsSync(abs)||fs.statSync(abs).size>this.maxFileBytes)continue;const text=fs.readFileSync(abs,"utf8");for(const m of text.matchAll(re)){refs.push({file:f.path,line:lineAt(text,m.index),symbol:needle});if(refs.length>=cap)break;}if(refs.length>=cap)break;}
    return {state:refs.length?"SUCCESS":"UNAVAILABLE",symbol:needle,references:refs};
  }
}
