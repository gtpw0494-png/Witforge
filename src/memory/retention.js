export function memoryExpired(record,now=Date.now()){const t=Date.parse(record?.expiresAt||"");return Number.isFinite(t)&&t<=now;}
export function retentionExpiry(policy="until-deleted",ttlMs=null,now=Date.now()){
  if(Number.isFinite(Number(ttlMs))&&Number(ttlMs)>0)return new Date(now+Math.max(60000,Number(ttlMs))).toISOString();
  const p=String(policy||"until-deleted");
  if(p==="session")return new Date(now+24*3600000).toISOString();
  if(p==="30-days")return new Date(now+30*24*3600000).toISOString();
  if(p==="90-days")return new Date(now+90*24*3600000).toISOString();
  return null;
}
