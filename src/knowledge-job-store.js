import fs from "node:fs";
import path from "node:path";

function writeJson(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+".tmp-"+process.pid+"-"+Date.now();
  fs.writeFileSync(tmp,JSON.stringify(value,null,2)+"\n","utf8");
  fs.renameSync(tmp,file);
}

export class KnowledgeJobStore{
  constructor({stateRoot=path.resolve("state")}={}){
    this.file=path.join(stateRoot,"knowledge-autonomy","jobs.json");
    if(!fs.existsSync(this.file))writeJson(this.file,[]);
  }
  read(){try{const v=JSON.parse(fs.readFileSync(this.file,"utf8"));return Array.isArray(v)?v:[]}catch{return[]}}
  record(entry={}){
    const rows=this.read();
    const now=new Date().toISOString();
    const row={id:entry.id||`kj-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,created_at:entry.created_at||now,updated_at:now,...entry};
    rows.push(row);writeJson(this.file,rows.slice(-1000));return row;
  }
  get(id){return this.read().find(x=>x.id===id||x.job_id===id)||null}
  update(id,patch={}){
    const rows=this.read();const i=rows.findIndex(x=>x.id===id||x.job_id===id);
    if(i<0)return{state:"UNAVAILABLE",message:"Knowledge job not found.",id};
    rows[i]={...rows[i],...patch,updated_at:new Date().toISOString()};writeJson(this.file,rows);
    return{state:"SUCCESS",job:rows[i]};
  }
  list(limit=50){return this.read().slice(-Math.max(1,Number(limit)||50)).reverse()}
}
export default KnowledgeJobStore;
