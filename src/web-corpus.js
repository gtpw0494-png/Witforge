import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import {canonicalUrl,inspectExternalContent,sanitizeExternalText} from "./content-security.js";

const OPEN_LICENSES = new Set(["ODC-BY-1.0","CC-BY-4.0","CC-BY-SA-4.0","CC0-1.0","PUBLIC-DOMAIN","MIT","APACHE-2.0"]);
const cleanText = s => String(s||"")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ")
  .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi," ")
  .replace(/<[^>]+>/g," ")
  .replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#39;/gi,"'")
  .replace(/\s+/g," ").trim();
function isPrivateIp(ip){
  if(net.isIP(ip)===4){const p=ip.split('.').map(Number);return p[0]===10||p[0]===127||p[0]===0||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168);}
  if(net.isIP(ip)===6){const x=ip.toLowerCase();return x==="::1"||x.startsWith("fc")||x.startsWith("fd")||x.startsWith("fe80:");}
  return false;
}
async function assertPublicTarget(url){
  const u=new URL(url);if(!["http:","https:"].includes(u.protocol))throw new Error("Only http/https URLs are supported.");
  if(["localhost","localhost.localdomain"].includes(u.hostname.toLowerCase()))throw new Error("Local/private targets are blocked by default.");
  if(net.isIP(u.hostname)&&isPrivateIp(u.hostname))throw new Error("Local/private targets are blocked by default.");
  const rows=await dns.lookup(u.hostname,{all:true});if(rows.some(x=>isPrivateIp(x.address)))throw new Error("Target resolves to a local/private address and is blocked by default.");
  return u;
}
function robotsAllows(text,pathName,userAgent="IntraultUniversalionBot"){
  const lines=String(text||"").split(/\r?\n/).map(x=>x.replace(/#.*/,"").trim()).filter(Boolean);let active=false;const dis=[];
  for(const line of lines){const i=line.indexOf(":");if(i<0)continue;const k=line.slice(0,i).trim().toLowerCase(),v=line.slice(i+1).trim();
    if(k==="user-agent")active=v==="*"||userAgent.toLowerCase().includes(v.toLowerCase());
    else if(active&&k==="disallow"&&v)dis.push(v);
  }
  return !dis.some(x=>pathName.startsWith(x));
}
export class WebCorpus{
  constructor({root,store,audit,documentStore=null}){this.root=root;this.store=store;this.audit=audit;this.documentStore=documentStore;this.registryPath=path.join(root,"research","web_source_registry.json");this.outFile=path.join(root,"model","data","web-corpus.jsonl");this.quarantineFile=path.join(root,"model","data","web-quarantine.jsonl");fs.mkdirSync(path.dirname(this.outFile),{recursive:true});}
  registry(){return JSON.parse(fs.readFileSync(this.registryPath,"utf8"));}
  status(){const r=this.registry();return {state:"SUCCESS",sourceClasses:r.sources.length,records:fs.existsSync(this.outFile)?fs.readFileSync(this.outFile,"utf8").split(/\n/).filter(Boolean).length:0,file:this.outFile,sources:r.sources};}
  async robots(url){const u=await assertPublicTarget(url);const robotsUrl=`${u.protocol}//${u.host}/robots.txt`;try{const r=await fetch(robotsUrl,{headers:{"user-agent":"IntraultUniversalionBot/0.22 (+local research)"},signal:AbortSignal.timeout(8000)});if(!r.ok)return {state:"UNKNOWN",allowed:true,url:robotsUrl,reason:`robots HTTP ${r.status}`};const text=await r.text();return {state:"SUCCESS",allowed:robotsAllows(text,u.pathname),url:robotsUrl};}catch(e){return {state:"UNKNOWN",allowed:true,url:robotsUrl,reason:e.message};}}
  _knownHashes(){const set=new Set();for(const file of [this.outFile,this.quarantineFile])if(fs.existsSync(file))for(const line of fs.readFileSync(file,"utf8").split(/\n/)){if(!line.trim())continue;try{const r=JSON.parse(line);if(r.contentSha256||r.sha256)set.add(r.contentSha256||r.sha256);}catch{}}return set;}
  append(row,{quarantine=false}={}){const contentHash=row.contentSha256||crypto.createHash("sha256").update(String(row.text||"")).digest("hex");if(this._knownHashes().has(contentHash))return {digest:contentHash,duplicate:true};const canonical=JSON.stringify({...row,contentSha256:contentHash});const digest=crypto.createHash("sha256").update(canonical).digest("hex");fs.appendFileSync(quarantine?this.quarantineFile:this.outFile,JSON.stringify({...row,contentSha256:contentHash,recordSha256:digest})+"\n");return {digest,contentHash,duplicate:false};}
  async ingestUrl({url,license="UNKNOWN",licenseSource="UNVERIFIED",respectRobots=true,maxBytes=1_500_000,promoteTraining=false}={}){
    if(!url)return {state:"BLOCKED",message:"A URL is required."};let u;try{u=await assertPublicTarget(canonicalUrl(url));}catch(e){return {state:"BLOCKED",message:e.message};}
    const rob=respectRobots?await this.robots(u.toString()):{state:"SKIPPED",allowed:true};if(!rob.allowed)return {state:"BLOCKED",message:"robots.txt disallows this path for the project crawler.",robots:rob};
    let r;try{r=await fetch(u,{redirect:"follow",headers:{"user-agent":"IntraultUniversalionBot/0.22 (+local research)"},signal:AbortSignal.timeout(20000)});}catch(e){return {state:"UNAVAILABLE",message:e.message,robots:rob};}
    if(!r.ok)return {state:"FAILURE",message:`HTTP ${r.status}`,url:r.url,robots:rob};
    const type=(r.headers.get("content-type")||"").toLowerCase();if(!type.includes("text/")&&!type.includes("json")&&!type.includes("xml"))return {state:"BLOCKED",message:`Unsupported content type ${type||"unknown"}.`,url:r.url};
    const ab=await r.arrayBuffer();if(ab.byteLength>maxBytes)return {state:"BLOCKED",message:`Response exceeds ${maxBytes} byte ingestion limit.`,bytes:ab.byteLength};
    const raw=new TextDecoder().decode(ab);const extracted=type.includes("html")?cleanText(raw):String(raw).replace(/\s+/g," ").trim();if(extracted.length<20)return {state:"FAILURE",message:"Fetched content contained too little usable text."};
    const security=inspectExternalContent(extracted);const text=sanitizeExternalText(extracted).slice(0,500_000);const licenseVerified=OPEN_LICENSES.has(String(license).toUpperCase())&&licenseSource!=="UNVERIFIED";
    const trainingEligible=licenseVerified&&promoteTraining===true&&!security.trainingBlocked;const quarantine=security.risk==='HIGH'||!licenseVerified;
    const row={format:"iu-web-record-v2",sourceClass:"direct-web",url:canonicalUrl(r.url),retrievedAt:new Date().toISOString(),contentType:type||null,license,licenseSource,licenseVerified,retrievalEligible:true,trainingEligible,trainingApproved:promoteTraining===true,quarantineState:quarantine?'QUARANTINED':'PROMOTED',externalContent:true,instructionAuthority:'NONE',security,text};
    const stored=this.append(row,{quarantine});if(stored.duplicate)return {state:"SUCCESS",message:"Duplicate content was already recorded; no second copy was stored.",url:row.url,duplicate:true,contentSha256:stored.contentHash,trainingEligible,security};
    const rec=this.store.add({kind:"knowledge-analysis",title:`Web research: ${new URL(r.url).hostname}`,source:r.url,text:row.text,state:"SUCCESS",verified:true,web:{digest:stored.digest,license,licenseSource,trainingEligible,quarantineState:row.quarantineState,security,robots:rob}});
    let document=null;
    if(this.documentStore){
      document=await this.documentStore.ingest({
        source_id:`web:${new URL(r.url).hostname}`,
        source_name:`Web: ${new URL(r.url).hostname}`,
        source_type:"direct-web",
        source_url:row.url,
        original_uri:r.url,
        canonical_uri:row.url,
        title:`Web research: ${new URL(r.url).hostname}`,
        language:"unknown",
        mime_type:type||"text/plain",
        publisher:new URL(r.url).hostname,
        retrieved_at:row.retrievedAt,
        license,
        license_source:licenseSource,
        text:row.text,
        retrieval_eligible:!quarantine,
        source_training_eligible:licenseVerified,
        training_approved:promoteTraining===true,
        provenance:{robots:rob,webRecordSha256:stored.digest,contentSha256:stored.contentHash,knowledgeId:rec.id},
        security
      });
    }
    this.audit?.append({type:"web.ingest",url:r.url,digest:stored.digest,knowledgeId:rec.id,documentId:document?.document?.id||null,documentState:document?.state||null,trainingEligible,quarantineState:row.quarantineState,license,robots:rob.state,promptInjectionSignals:security.promptInjectionSignals});
    const documentState=document?document.state:"SUCCESS";
    const state=documentState==="SUCCESS"?"SUCCESS":"PARTIAL";
    const documentNote=documentState==="SUCCESS"?"":" The compatibility web record was stored, but the provenance document plane did not accept the record.";
    return {state,message:`Fetched ${row.text.length} characters from ${new URL(r.url).hostname}. External content has no instruction authority. ${quarantine?'Record quarantined for review.':'Record promoted for retrieval.'} Training eligibility: ${trainingEligible?'ELIGIBLE':'NOT ELIGIBLE'}.${documentNote}`,url:row.url,characters:row.text.length,sha256:stored.digest,contentSha256:stored.contentHash,knowledgeId:rec.id,document,trainingEligible,quarantineState:row.quarantineState,license,licenseSource,security,robots:rob};
  }
}
