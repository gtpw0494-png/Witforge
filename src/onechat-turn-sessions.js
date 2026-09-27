import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const terminal=new Set(["SUCCESS","PARTIAL","FAILURE","ERROR","DENIED","BLOCKED","UNAVAILABLE","CANCELLED","TIMEOUT","INTERRUPTED"]);

function safeInput(input={}){
  const out={};
  for(const [k,v] of Object.entries(input)){
    if(["signal","onEvent"].includes(k))continue;
    if(v===undefined||typeof v==="function")continue;
    out[k]=v;
  }
  return out;
}
function atomicJson(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+".tmp-"+process.pid+"-"+Date.now();
  fs.writeFileSync(tmp,JSON.stringify(value,null,2)+"\n","utf8");
  fs.renameSync(tmp,file);
}

export class OneChatTurnSessions{
  constructor({onechat,audit=null,maxEvents=200,stateRoot="./state"}={}){
    this.onechat=onechat;this.audit=audit;this.maxEvents=Math.max(20,maxEvents);this.sessions=new Map();
    this.root=path.resolve(stateRoot,"onechat-turn-sessions");fs.mkdirSync(this.root,{recursive:true});
    this._hydrate();
  }
  _snapshotFile(id){return path.join(this.root,String(id)+".json")}
  _eventsFile(id){return path.join(this.root,String(id)+".events.jsonl")}
  _persistState(s){
    atomicJson(this._snapshotFile(s.id),{
      format:"uai.onechat.turn-session.v1",id:s.id,chatId:s.chatId,ownerId:s.ownerId,state:s.state,
      createdAt:s.createdAt,updatedAt:s.updatedAt,seq:s.seq,cancelRequested:s.cancelRequested===true,
      result:s.result,error:s.error,input:s.input||{},recoveredFrom:s.recoveredFrom||null
    });
  }
  _appendEvent(s,e){fs.appendFileSync(this._eventsFile(s.id),JSON.stringify(e)+"\n","utf8")}
  _readEvents(id){
    const file=this._eventsFile(id);if(!fs.existsSync(file))return [];
    const out=[];
    for(const line of fs.readFileSync(file,"utf8").split(/\r?\n/)){
      if(!line.trim())continue;
      try{const e=JSON.parse(line);if(e&&Number.isFinite(Number(e.seq)))out.push(e);}catch{}
    }
    return out.slice(-this.maxEvents);
  }
  _hydrate(){
    for(const name of fs.readdirSync(this.root).filter(x=>x.endsWith(".json")&&!x.endsWith(".events.jsonl"))){
      let d=null;try{d=JSON.parse(fs.readFileSync(path.join(this.root,name),"utf8"));}catch{continue}
      if(d?.format!=="uai.onechat.turn-session.v1"||!d.id)continue;
      const events=this._readEvents(d.id),lastSeq=events.reduce((m,e)=>Math.max(m,Number(e.seq)||0),Number(d.seq)||0);
      const s={...d,seq:lastSeq,events,controller:new AbortController(),result:d.result??null,error:d.error??null,cancelRequested:d.cancelRequested===true,input:d.input||{},recoveredPreviousState:d.state};
      this.sessions.set(s.id,s);
    }
    for(const s of this.sessions.values()){
      if(s.state==="QUEUED"){
        this._emit(s,"recovery",{state:"QUEUED",message:"Queued turn recovered after restart; safe execution resumed."});
        queueMicrotask(()=>this._run(s,s.input||{}));
      }else if(["RUNNING","CANCEL_REQUESTED"].includes(s.state)){
        const previousState=s.state;
        s.state="INTERRUPTED";s.result=null;s.error="Server/process restart interrupted active generation.";
        this._emit(s,"recovery",{state:"INTERRUPTED",previousState,message:"Active generation was interrupted by a process restart. It was not reported as completed."});
        this._persistState(s);
        this.audit?.append?.({type:"onechat.turn.session.interrupted",sessionId:s.id,chatId:s.chatId,previousState});
      }
      delete s.recoveredPreviousState;
    }
  }
  _emit(s,type,data={}){
    const e={seq:(s.seq||0)+1,at:new Date().toISOString(),type,...data};s.seq=e.seq;s.updatedAt=e.at;s.events.push(e);
    if(s.events.length>this.maxEvents)s.events.splice(0,s.events.length-this.maxEvents);
    this._appendEvent(s,e);
    if(type!=="token"||e.seq%16===0)this._persistState(s);
    return e;
  }
  start(input={}){
    const id="turn-session-"+crypto.randomUUID(),controller=new AbortController(),now=new Date().toISOString(),clean=safeInput(input);
    const s={id,chatId:clean.chatId||null,ownerId:clean.ownerId||null,state:"QUEUED",createdAt:now,updatedAt:now,seq:0,events:[],controller,result:null,error:null,cancelRequested:false,input:clean,recoveredFrom:clean.recoveredFrom||null};
    this.sessions.set(id,s);this._emit(s,"state",{state:"QUEUED",message:"Turn queued."});this._persistState(s);
    queueMicrotask(()=>this._run(s,clean));
    return this.public(s);
  }
  async _run(s,input){
    try{
      if(s.controller.signal.aborted)return this._cancelled(s,"Cancelled before execution.");
      s.state="RUNNING";this._emit(s,"state",{state:"RUNNING",message:"Turn execution started."});this._persistState(s);
      const result=await this.onechat.handle({...input,signal:s.controller.signal,onEvent:e=>this._emit(s,e?.type||"progress",e||{})});
      if(s.controller.signal.aborted||s.cancelRequested)return this._cancelled(s,"Generation cancelled; late result discarded.");
      s.result=result;s.state=terminal.has(result?.state)?result.state:"SUCCESS";
      this._emit(s,"result",{state:s.state,result});this._persistState(s);
      this.audit?.append?.({type:"onechat.turn.session.completed",sessionId:s.id,chatId:s.chatId,state:s.state});
    }catch(e){
      if(s.controller.signal.aborted||s.cancelRequested)return this._cancelled(s,"Generation cancelled.");
      s.state="ERROR";s.error=String(e?.message||e);this._emit(s,"error",{state:"ERROR",message:s.error});this._persistState(s);
      this.audit?.append?.({type:"onechat.turn.session.error",sessionId:s.id,chatId:s.chatId,error:s.error});
    }
  }
  _cancelled(s,message){
    s.state="CANCELLED";s.result=null;this._emit(s,"state",{state:"CANCELLED",message});this._persistState(s);
    this.audit?.append?.({type:"onechat.turn.session.cancelled",sessionId:s.id,chatId:s.chatId});
    return this.public(s);
  }
  cancel(id,{ownerId=null}={}){
    const s=this.sessions.get(String(id));if(!s)return {state:"UNAVAILABLE",message:"Turn session not found."};
    if(s.ownerId&&ownerId&&s.ownerId!==ownerId)return {state:"DENIED",message:"Turn session is owned by another identity."};
    if(terminal.has(s.state))return {state:s.state,message:"Turn session is already terminal.",session:this.public(s)};
    s.cancelRequested=true;s.state="CANCEL_REQUESTED";this._emit(s,"state",{state:"CANCEL_REQUESTED",message:"Cancellation requested."});this._persistState(s);
    try{s.controller.abort()}catch{}
    return {state:"CANCEL_REQUESTED",session:this.public(s)};
  }
  resume(id,{ownerId=null}={}){
    const s=this.sessions.get(String(id));if(!s)return {state:"UNAVAILABLE",message:"Turn session not found."};
    if(s.ownerId&&ownerId&&s.ownerId!==ownerId)return {state:"DENIED",message:"Turn session is owned by another identity."};
    if(s.state!=="INTERRUPTED")return {state:"BLOCKED",message:"Only an interrupted session can be explicitly resumed.",session:this.public(s)};
    const next=this.start({...s.input,ownerId:s.ownerId,recoveredFrom:s.id});
    this.audit?.append?.({type:"onechat.turn.session.resumed",sessionId:next.id,recoveredFrom:s.id,chatId:s.chatId});
    return {state:"SUCCESS",session:next,recoveredFrom:s.id};
  }
  get(id,{ownerId=null,since=0}={}){
    const s=this.sessions.get(String(id));if(!s)return {state:"UNAVAILABLE",message:"Turn session not found."};
    if(s.ownerId&&ownerId&&s.ownerId!==ownerId)return {state:"DENIED",message:"Turn session is owned by another identity."};
    return {state:"SUCCESS",session:this.public(s),events:s.events.filter(e=>e.seq>Number(since||0))};
  }
  public(s){
    return {id:s.id,chatId:s.chatId,state:s.state,createdAt:s.createdAt,updatedAt:s.updatedAt,seq:s.seq,cancelRequested:s.cancelRequested===true,result:s.result,error:s.error,recoveredFrom:s.recoveredFrom||null,resumable:s.state==="INTERRUPTED"};
  }
}
export default OneChatTurnSessions;
