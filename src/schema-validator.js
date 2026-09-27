const typeOf=v=>Array.isArray(v)?"array":v===null?"null":typeof v;

function add(errors,path,message){errors.push({path:path||"$",message});}
export function validateSchema(schema,value,path="$"){
  const errors=[];
  const walk=(s,v,p)=>{
    if(!s||typeof s!=="object")return;
    if(Array.isArray(s.anyOf)){
      const candidates=s.anyOf.map(x=>validateSchema(x,v,p));
      if(!candidates.some(x=>x.state==="SUCCESS"))add(errors,p,"does not match any allowed schema");
      return;
    }
    const actual=typeOf(v);
    const matchesType=t=>t==="integer"?(typeof v==="number"&&Number.isInteger(v)):actual===t;
    if(Array.isArray(s.type)){
      if(!s.type.some(matchesType)){add(errors,p,`expected one of ${s.type.join(", ")}, got ${actual}`);return;}
    }else if(s.type&&!matchesType(s.type)){add(errors,p,`expected ${s.type}, got ${actual}`);return;}
    if(Object.hasOwn(s,"const")&&v!==s.const)add(errors,p,"does not match required constant");
    if(Array.isArray(s.enum)&&!s.enum.some(x=>Object.is(x,v)))add(errors,p,"is not in the allowed enum");
    if(typeof v==="string"){
      if(Number.isInteger(s.minLength)&&v.length<s.minLength)add(errors,p,`must have at least ${s.minLength} characters`);
      if(Number.isInteger(s.maxLength)&&v.length>s.maxLength)add(errors,p,`must have at most ${s.maxLength} characters`);
      if(s.pattern){try{if(!(new RegExp(s.pattern)).test(v))add(errors,p,"does not match required pattern");}catch{add(errors,p,"schema pattern is invalid");}}
    }
    if(typeof v==="number"){
      if(Number.isFinite(s.minimum)&&v<s.minimum)add(errors,p,`must be >= ${s.minimum}`);
      if(Number.isFinite(s.maximum)&&v>s.maximum)add(errors,p,`must be <= ${s.maximum}`);
      if(s.type==="integer"&&!Number.isInteger(v))add(errors,p,"must be an integer");
    }
    if(Array.isArray(v)){
      if(Number.isInteger(s.minItems)&&v.length<s.minItems)add(errors,p,`must contain at least ${s.minItems} item(s)`);
      if(Number.isInteger(s.maxItems)&&v.length>s.maxItems)add(errors,p,`must contain at most ${s.maxItems} item(s)`);
      if(s.uniqueItems){
        const seen=new Set();
        for(const item of v){const k=JSON.stringify(item);if(seen.has(k)){add(errors,p,"must contain unique items");break;}seen.add(k);}
      }
      if(s.items)v.forEach((item,i)=>walk(s.items,item,`${p}[${i}]`));
    }
    if(v&&typeof v==="object"&&!Array.isArray(v)){
      const props=s.properties||{};
      for(const key of s.required||[])if(!Object.hasOwn(v,key))add(errors,`${p}.${key}`,"is required");
      for(const [key,val] of Object.entries(v)){
        if(Object.hasOwn(props,key))walk(props[key],val,`${p}.${key}`);
        else if(s.additionalProperties===false)add(errors,`${p}.${key}`,"additional property is not allowed");
        else if(s.additionalProperties&&typeof s.additionalProperties==="object")walk(s.additionalProperties,val,`${p}.${key}`);
      }
    }
  };
  walk(schema,value,path);
  return {state:errors.length?"BLOCKED":"SUCCESS",valid:errors.length===0,errors};
}
