import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const canonical=value=>Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value&&typeof value==="object"
    ? `{${Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")}}`
    : JSON.stringify(value);

const digest=value=>crypto.createHash("sha256").update(value).digest("hex");

export class AuditLog {
  constructor(root) {
    fs.mkdirSync(root,{recursive:true});
    this.file=path.join(root,"audit.jsonl");
  }

  _lines(){
    if(!fs.existsSync(this.file))return [];
    return fs.readFileSync(this.file,"utf8").split(/\n/).filter(Boolean);
  }

  _records(){
    const out=[];
    for(const line of this._lines()){
      try{out.push({line,record:JSON.parse(line)});}catch{out.push({line,record:null});}
    }
    return out;
  }

  _anchor(){
    const rows=this._records();
    for(let i=rows.length-1;i>=0;i--){
      if(rows[i].record?.chainVersion==="uai-audit-v1"&&rows[i].record?.hash){
        return {prevHash:rows[i].record.hash,legacyPrefix:null};
      }
    }
    const legacyText=rows.map(x=>x.line).join("\n")+(rows.length?"\n":"");
    return {
      prevHash:`legacy-sha256:${digest(legacyText)}`,
      legacyPrefix:rows.length
    };
  }

  append(event){
    const anchor=this._anchor();
    const body={
      id:crypto.randomUUID(),
      at:new Date().toISOString(),
      ...event,
      chainVersion:"uai-audit-v1",
      prevHash:anchor.prevHash,
      ...(anchor.legacyPrefix!==null?{legacyRecordsAnchored:anchor.legacyPrefix}:{})
    };
    const hash=`sha256:${digest(canonical(body))}`;
    const record={...body,hash};
    fs.appendFileSync(this.file,JSON.stringify(record)+"\n");
    return record;
  }

  list(limit=100){
    return this._records().map(x=>x.record).filter(Boolean).slice(-Math.max(1,Number(limit)||100));
  }

  verify(){
    const rows=this._records();
    if(!rows.length)return {state:"SUCCESS",records:0,legacyRecords:0,verifiedRecords:0,message:"Audit log is empty."};

    let firstChain=-1;
    for(let i=0;i<rows.length;i++){
      if(rows[i].record?.chainVersion==="uai-audit-v1"&&rows[i].record?.hash){firstChain=i;break;}
      if(!rows[i].record)return {state:"DENIED",message:"Audit log contains invalid JSON.",index:i};
    }
    if(firstChain<0)return {state:"PARTIAL",records:rows.length,legacyRecords:rows.length,verifiedRecords:0,message:"Only legacy unhashed audit records exist; the first v0.43 append will anchor them."};

    const legacyText=rows.slice(0,firstChain).map(x=>x.line).join("\n")+(firstChain?"\n":"");
    const expectedAnchor=`legacy-sha256:${digest(legacyText)}`;
    if(rows[firstChain].record.prevHash!==expectedAnchor){
      return {state:"DENIED",message:"Legacy audit prefix no longer matches the anchored digest.",index:firstChain,expected:expectedAnchor,actual:rows[firstChain].record.prevHash};
    }

    let prev=null;
    for(let i=firstChain;i<rows.length;i++){
      const record=rows[i].record;
      if(!record||record.chainVersion!=="uai-audit-v1"||!record.hash)return {state:"DENIED",message:"Audit chain is interrupted.",index:i};
      if(i>firstChain&&record.prevHash!==prev)return {state:"DENIED",message:"Audit previous-hash linkage mismatch.",index:i,expected:prev,actual:record.prevHash};
      const body={...record};delete body.hash;
      const expected=`sha256:${digest(canonical(body))}`;
      if(expected!==record.hash)return {state:"DENIED",message:"Audit record hash mismatch.",index:i,expected,actual:record.hash};
      prev=record.hash;
    }
    return {state:"SUCCESS",records:rows.length,legacyRecords:firstChain,verifiedRecords:rows.length-firstChain,headHash:prev,message:"Audit chain verified."};
  }
}
