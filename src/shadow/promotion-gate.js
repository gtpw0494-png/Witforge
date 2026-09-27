const ownerAuth=a=>Boolean(a?.allowed&&a?.auth?.authenticated&&a.auth.role==="owner");
export class PromotionGate{
  constructor({audit=null}={}){this.audit=audit;}
  evaluate({kind,record,authorization,checks={}}={}){
    if(!record)return {state:"FAILURE",eligible:false,message:"Promotion record not found."};
    if(!ownerAuth(authorization))return {state:"DENIED",eligible:false,message:"Separate authenticated local-owner authorization is required."};
    const required=kind==="light"?["tests","security","shadowReview"]:["evidence","evaluation"];
    const missing=required.filter(k=>checks[k]!==true);
    if(missing.length)return {state:"BLOCKED",eligible:false,message:"Promotion checks are incomplete.",missing};
    const out={state:"SUCCESS",eligible:true,kind,recordId:record.id,authorizedBy:authorization.auth.identityId,checks,decisionAt:new Date().toISOString()};
    this.audit?.append({type:"promotion.gate",...out});return out;
  }
}
