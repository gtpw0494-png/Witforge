const envName=name=>"IUV_PLUGIN_SECRET_"+String(name||"").toUpperCase().replace(/[^A-Z0-9_]/g,"_");

export class PluginSecretBroker{
  constructor({getter=null}={}){
    this.getter=getter||((name)=>process.env[envName(name)]);
  }
  resolve(allowed=[],requested=[]){
    const allow=new Set((allowed||[]).map(String));
    const ask=[...new Set((requested||[]).map(String))];
    const denied=ask.filter(x=>!allow.has(x));
    if(denied.length)return {state:"DENIED",message:"Plugin requested secrets outside its manifest scope.",denied};
    const values={};
    const missing=[];
    for(const name of ask){
      const value=this.getter(name);
      if(value===undefined||value===null||String(value)==="")missing.push(name);
      else values[name]=String(value);
    }
    if(missing.length)return {state:"UNAVAILABLE",message:"Required plugin secret is not configured.",missing};
    return {state:"SUCCESS",values,names:Object.keys(values)};
  }
}

export function redactSecretValues(value,secrets={}){
  const vals=Object.values(secrets).filter(x=>String(x).length>=4).map(String);
  const redactString=s=>vals.reduce((out,secret)=>out.split(secret).join("[REDACTED]"),String(s));
  if(typeof value==="string")return redactString(value);
  if(Array.isArray(value))return value.map(x=>redactSecretValues(x,secrets));
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redactSecretValues(v,secrets)]));
  return value;
}
