export class AuditIntegrity{
  constructor(audit){this.audit=audit;}
  verify(){const result=this.audit?.verify?.()||{state:"UNAVAILABLE",message:"Audit verifier is unavailable."};return {state:result.state==="SUCCESS"?"SUCCESS":result.state,verified:result.state==="SUCCESS",result};}
}
