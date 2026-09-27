import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {execFileSync,spawnSync} from "node:child_process";
import {PlatformStateStore} from "../platform-state-store.js";
const iso=()=>new Date().toISOString();
const hashBuffer=b=>crypto.createHash("sha256").update(b).digest("hex");
const extMap={".pdf":["pdf","application/pdf"],".png":["image","image/png"],".jpg":["image","image/jpeg"],".jpeg":["image","image/jpeg"],".webp":["image","image/webp"],".wav":["audio","audio/wav"],".mp3":["audio","audio/mpeg"],".m4a":["audio","audio/mp4"],".mp4":["video","video/mp4"],".mov":["video","video/quicktime"],".webm":["video","video/webm"],".csv":["table","text/csv"],".json":["structured","application/json"],".txt":["text","text/plain"],".md":["text","text/markdown"]};
function command(name){try{return Boolean(execFileSync("sh",["-lc","command -v "+JSON.stringify(name)],{encoding:"utf8",timeout:3000}).trim());}catch{return false;}}
function mimeFor(file){return extMap[path.extname(file).toLowerCase()]||["structured","application/octet-stream"];}
function within(root,target){return target===root||target.startsWith(root+path.sep);}
export class MultimodalPipeline{
  constructor({stateRoot=null,audit=null,provenanceGraph=null,allowedRoots=null}={}){
    this.stateRoot=path.resolve(stateRoot||path.join(process.cwd(),"state"));this.audit=audit;this.graph=provenanceGraph;this.db=new PlatformStateStore(this.stateRoot);
    this.allowedRoots=(allowedRoots||[path.join(this.stateRoot,"media-input"),path.join(process.cwd(),"data")]).map(x=>path.resolve(x));for(const r of this.allowedRoots)fs.mkdirSync(r,{recursive:true});
  }
  status(){
    const tools={pdftotext:command("pdftotext"),tesseract:command("tesseract"),ffmpeg:command("ffmpeg"),ffprobe:command("ffprobe")};
    return {state:"SUCCESS",contract:"multimodal-artifact-v1",tools,pdf:tools.pdftotext?"CONNECTED":"UNAVAILABLE",ocr:tools.tesseract?"CONNECTED":"UNAVAILABLE",audioVideoProbe:tools.ffprobe?"CONNECTED":"UNAVAILABLE",message:"This status reports local artifact parsing/probing only. Native ForgeVision/ForgeAudio/ForgeVideo/ForgeMultimodal model availability is reported separately by the model capability registry."};
  }
  _resolve(file){const target=path.resolve(String(file||""));return this.allowedRoots.some(r=>within(r,target))?target:null;}
  register({path:file,sourceId=null,ownerId=null,metadata={}}={}){
    const target=this._resolve(file);if(!target)return {state:"DENIED",message:"Media path is outside approved local media roots.",allowedRoots:this.allowedRoots};
    if(!fs.existsSync(target)||!fs.statSync(target).isFile())return {state:"UNAVAILABLE",message:"Media file is unavailable."};
    const data=fs.readFileSync(target),[modality,mediaType]=mimeFor(target),digest=hashBuffer(data),id="media-"+digest;
    const rec={id,sourceId:String(sourceId||("file:"+path.basename(target))),ownerId:ownerId||null,path:target,modality,mediaType,contentHash:digest,bytes:data.length,metadata:metadata&&typeof metadata==="object"?metadata:{},parserVersion:null,derived:[],state:"REGISTERED",createdAt:iso(),updatedAt:iso()};
    const cur=this.db.get("media-artifact",id),r=cur.record?this.db.cas("media-artifact",id,cur.version,{...cur.record,...rec,createdAt:cur.record.createdAt||rec.createdAt},{type:"media.registered"}):this.db.create("media-artifact",rec);
    let provenanceNodeId=null;if(r.state==="SUCCESS"&&this.graph){const n=this.graph.addNode({type:"media-source",subjectId:id,sourceId:rec.sourceId,ownerId:rec.ownerId,uri:"file:"+target,hash:digest,metadata:{modality,mediaType}});provenanceNodeId=n.node?.id||null;}
    if(r.state==="SUCCESS")this.audit?.append({type:"media.registered",mediaId:id,modality,bytes:data.length});return r.state==="SUCCESS"?{state:"SUCCESS",artifact:rec,provenanceNodeId}:r;
  }
  get(id){return this.db.get("media-artifact",id).record||null;}
  contentDescriptor(id,{ownerId=null}={}){
    const a=this.get(id);if(!a)return {state:"UNAVAILABLE",message:"Media artifact not found."};
    if(a.ownerId&&ownerId&&a.ownerId!==ownerId)return {state:"DENIED",message:"Media artifact is owned by another identity."};
    const target=this._resolve(a.path);if(!target)return {state:"DENIED",message:"Registered media path is outside approved local roots."};
    if(!fs.existsSync(target)||!fs.statSync(target).isFile())return {state:"UNAVAILABLE",message:"Registered media file is unavailable."};
    const [modality,mediaType]=mimeFor(target),stat=fs.statSync(target);
    return {state:"SUCCESS",id:a.id,file:target,modality,mediaType:a.mediaType||mediaType,bytes:stat.size,label:a.metadata?.originalName||path.basename(target),contentHash:a.contentHash||null,sourceId:a.sourceId||null};
  }
  list(limit=100){return this.db.list("media-artifact",limit).records||[];}
  _save(rec,event){const cur=this.db.get("media-artifact",rec.id);if(!cur.record)return {state:"FAILURE",message:"Media artifact not found."};const r=this.db.cas("media-artifact",rec.id,cur.version,rec,{type:event});return r.state==="SUCCESS"?rec:r;}
  _deriveProvenance(artifact,derived){
    if(!this.graph)return [];const sources=this.graph.listNodes({limit:10000}).filter(x=>x.type==="media-source"&&x.subjectId===artifact.id),source=sources[0],ids=[];
    for(const d of derived){const n=this.graph.addNode({type:"derived-text",subjectId:d.id,sourceId:artifact.sourceId,ownerId:artifact.ownerId,hash:d.contentHash,metadata:{mediaId:artifact.id,locator:d.locator,kind:d.kind}});if(n.node){ids.push(n.node.id);if(source)this.graph.addEdge({fromId:source.id,toId:n.node.id,relation:"NORMALIZED_TO",metadata:{locator:d.locator}});}}
    return ids;
  }
  extract(id){
    const a=this.get(id);if(!a)return {state:"FAILURE",message:"Media artifact not found."};if(!fs.existsSync(a.path))return {state:"UNAVAILABLE",message:"Registered media file no longer exists."};
    let derived=[],parser=null;
    try{
      if(["text","table","structured"].includes(a.modality)){const text=fs.readFileSync(a.path,"utf8");derived=[{id:id+":text:1",kind:"text",contentHash:hashBuffer(Buffer.from(text)),text,locator:{}}];parser="node-utf8";}
      else if(a.modality==="pdf"&&command("pdftotext")){const text=execFileSync("pdftotext",["-layout",a.path,"-"],{encoding:"utf8",timeout:60000,maxBuffer:20_000_000});derived=text.split("\f").filter(x=>x.trim()).map((text,i)=>({id:id+":page:"+(i+1),kind:"page-text",contentHash:hashBuffer(Buffer.from(text)),text,locator:{page:i+1}}));parser="pdftotext";}
      else if(a.modality==="image"&&command("tesseract")){const p=spawnSync("tesseract",[a.path,"stdout","tsv"],{encoding:"utf8",timeout:60000,maxBuffer:20_000_000});if(p.status!==0)return {state:"ERROR",message:(p.stderr||"OCR failed").slice(0,2000)};const rows=p.stdout.split(/\n/).slice(1),items=[];for(const row of rows){const c=row.split("\t");if(c.length<12||!c[11]?.trim())continue;const [left,top,width,height]=c.slice(6,10).map(Number);items.push({text:c[11].trim(),bbox:[left,top,width,height]});}const text=items.map(x=>x.text).join(" ");derived=[{id:id+":ocr:1",kind:"ocr-text",contentHash:hashBuffer(Buffer.from(text)),text,locator:{},regions:items.map(x=>({text:x.text,locator:{bbox:x.bbox}}))}];parser="tesseract-tsv";}
      else if(["audio","video"].includes(a.modality)&&command("ffprobe")){const raw=execFileSync("ffprobe",["-v","quiet","-print_format","json","-show_format","-show_streams",a.path],{encoding:"utf8",timeout:30000,maxBuffer:5_000_000});const meta=JSON.parse(raw);derived=[{id:id+":probe:1",kind:"media-metadata",contentHash:hashBuffer(Buffer.from(raw)),text:"",locator:{startMs:0,endMs:Math.max(0,Number(meta.format?.duration||0)*1000)},metadata:meta}];parser="ffprobe";}else return {state:"UNAVAILABLE",message:"No verified local parser is connected for this modality.",artifact:a,capabilities:this.status()};
      const body={...a,derived,parserVersion:parser,state:derived.length?"PARSED":"PARTIAL",updatedAt:iso()},saved=this._save(body,"media.parsed");const provenanceNodeIds=this._deriveProvenance(body,derived);this.audit?.append({type:"media.parsed",mediaId:id,modality:a.modality,parser,derived:derived.length});return {state:"SUCCESS",artifact:saved,provenanceNodeIds};
    }catch(e){return {state:"ERROR",message:String(e.message||e).slice(0,2000),artifact:a};}
  }
}
