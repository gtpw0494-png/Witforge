export const CAPABILITY_STATES=Object.freeze(["CONNECTED","CONFIGURED","REGISTERED_SOURCE","DEGRADED","UNAVAILABLE","BLOCKED","EXPIRED"]);
const rank={CONNECTED:7,CONFIGURED:6,REGISTERED_SOURCE:5,DEGRADED:4,UNAVAILABLE:3,BLOCKED:2,EXPIRED:1};
export function capabilityTruth({id,type="capability",installed=false,configured=false,authenticated=false,executable=false,health=null,permitted=true,offline=false,lastFailure=null,sourceRegistered=false,expiresAt=null}={}){
 let state="UNAVAILABLE";
 if(expiresAt&&Date.now()>Date.parse(expiresAt))state="EXPIRED";
 else if(!permitted)state="BLOCKED";
 else if(executable&&health!=="failed")state="CONNECTED";
 else if(configured||authenticated)state=health==="failed"?"DEGRADED":"CONFIGURED";
 else if(sourceRegistered||installed)state="REGISTERED_SOURCE";
 return {id,type,state,installed:Boolean(installed),configured:Boolean(configured),authenticated:Boolean(authenticated),executable:Boolean(executable),health,permitted:Boolean(permitted),offline:Boolean(offline),lastFailure:lastFailure||null,expiresAt:expiresAt||null};
}
export function bestCapability(items=[]){return [...items].sort((a,b)=>(rank[b.state]||0)-(rank[a.state]||0))[0]||null;}
