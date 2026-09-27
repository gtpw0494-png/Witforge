import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {GovernanceDb} from "./governance-db.js";

class GovernanceRegistry {
  constructor({db,kind,legacyFile=null,seed=[]}){
    this.db=db;
    this.kind=kind;
    this.legacyFile=legacyFile;
    this._migrate();
    this._seed(seed);
  }

  _strip(x){if(!x)return null;const y={...x};delete y._version;return y;}

  _migrate(){
    if(!this.legacyFile||!fs.existsSync(this.legacyFile))return;
    let rows=[];try{rows=JSON.parse(fs.readFileSync(this.legacyFile,"utf8"));}catch{return;}
    for(const row of rows){
      if(!row?.id)continue;
      if(!this.db.get(this.kind,row.id).record)this.db.create(this.kind,row);
    }
    if(rows.length){try{fs.renameSync(this.legacyFile,this.legacyFile+".migrated-v043");}catch{}}
  }

  _seed(rows){
    for(const row of rows){
      if(this.db.get(this.kind,row.id).record)continue;
      const rec={createdAt:new Date().toISOString(),...row};
      const r=this.db.create(this.kind,rec);
      if(r.state!=="SUCCESS")throw new Error(r.message||`Failed to seed ${this.kind} ${row.id}`);
    }
  }

  list(limit=1000){
    return (this.db.list(this.kind,limit).records||[]).map(x=>this._strip(x));
  }

  get(id){
    const r=this.db.get(this.kind,id);
    return r.record?this._strip(r.record):null;
  }

  add(item){
    const rec={id:item.id||crypto.randomUUID(),createdAt:new Date().toISOString(),...item};
    const r=this.db.create(this.kind,rec);
    if(r.state!=="SUCCESS")throw new Error(r.message||`${this.kind} persistence failed.`);
    return rec;
  }
}

export class ControlCenter {
  constructor(stateRoot,audit){
    this.audit=audit;
    this.db=new GovernanceDb(stateRoot);
    this.accounts=new GovernanceRegistry({
      db:this.db,
      kind:"account",
      legacyFile:path.join(stateRoot,"accounts.json")
    });
    this.subscriptions=new GovernanceRegistry({
      db:this.db,
      kind:"subscription",
      legacyFile:path.join(stateRoot,"subscriptions.json")
    });
    this.plugins=new GovernanceRegistry({
      db:this.db,
      kind:"control-plugin",
      legacyFile:path.join(stateRoot,"plugins.json"),
      seed:[
        {id:"local-knowledge",name:"Local Knowledge",kind:"builtin",availability:"CONNECTED",capabilities:["knowledge.read","knowledge.write"]},
        {id:"local-development",name:"Local Development",kind:"builtin",availability:"CONNECTED",capabilities:["source.inspect","source.propose","source.apply"]}
      ]
    });
  }

  addAccount(input){
    const rec=this.accounts.add({
      name:String(input.name||"Account"),
      provider:String(input.provider||"local"),
      externalId:String(input.externalId||""),
      notes:String(input.notes||""),
      credentialState:"NOT_STORED_HERE"
    });
    this.audit?.append({type:"account.add",accountId:rec.id,provider:rec.provider});
    return rec;
  }

  addSubscription(input){
    const rec=this.subscriptions.add({
      name:String(input.name||"Subscription"),
      provider:String(input.provider||"manual"),
      plan:String(input.plan||""),
      amount:input.amount??null,
      currency:String(input.currency||""),
      renewal:String(input.renewal||""),
      source:"USER_RECORDED",
      liveBillingVerified:false
    });
    this.audit?.append({type:"subscription.add",subscriptionId:rec.id,provider:rec.provider});
    return rec;
  }

  registerPlugin(input){
    const rec=this.plugins.add({
      name:String(input.name||"Plugin"),
      kind:String(input.kind||"manifest"),
      endpoint:String(input.endpoint||""),
      capabilities:Array.isArray(input.capabilities)?input.capabilities.map(String):[],
      availability:"REGISTERED_NOT_VERIFIED"
    });
    this.audit?.append({type:"plugin.register",pluginId:rec.id});
    return rec;
  }
}
