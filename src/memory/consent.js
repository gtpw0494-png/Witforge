export const MEMORY_NAMESPACES=Object.freeze(["session","task","user","project","agent","source","model-training","audit"]);
export function validateMemoryConsent(input={}){
  const namespace=String(input.namespace||"user").toLowerCase();
  if(!MEMORY_NAMESPACES.includes(namespace))return {state:"BLOCKED",allowed:false,message:"Unsupported memory namespace.",available:MEMORY_NAMESPACES};
  if(input.consent!==true)return {state:"DENIED",allowed:false,message:"Explicit consent=true is required before durable memory is created."};
  return {state:"SUCCESS",allowed:true,namespace,consent:{state:"GRANTED",purpose:String(input.reason||"user-approved memory").slice(0,1000),grantedAt:new Date().toISOString()}};
}
