export class CapabilityBoundary{
  constructor({capabilityStatus=null}={}){this.capabilityStatus=capabilityStatus;}
  async authorize({capability,scope=[],operation=null}={}){
    if(!capability)return {state:"BLOCKED",allowed:false,message:"Explicit capability is required."};
    const scopes=new Set((scope||[]).map(String));if(!scopes.has("*")&&!scopes.has(capability))return {state:"DENIED",allowed:false,message:"Capability is outside the granted scope.",capability};
    if(!this.capabilityStatus)return {state:"SUCCESS",allowed:true,capability,operation,evidence:"scope-only"};
    const caps=await this.capabilityStatus(),row=caps.find(x=>x.id===capability);
    if(!row)return {state:"UNAVAILABLE",allowed:false,message:"Capability is not registered.",capability};
    if(row.availability!=="CONNECTED")return {state:row.availability||"UNAVAILABLE",allowed:false,message:row.reason||"Capability is not connected.",capability,evidence:row};
    return {state:"SUCCESS",allowed:true,capability,operation,evidence:row};
  }
}
