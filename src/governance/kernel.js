import {GOVERNANCE_VERSION,GOVERNANCE_SCHEMA_VERSION} from "./governance-version.js";
import {PROTECTED_GOVERNANCE_RULES,governanceChangeClass} from "./promotion-rules.js";
import {PolicyStore} from "./policy-store.js";
import {CapabilityBoundary} from "./capability-boundary.js";
import {EmergencyStop} from "./emergency-stop.js";
import {AuditIntegrity} from "./audit-integrity.js";
import {TrustedDeviceRegistry} from "./trusted-device.js";

export class GovernanceKernel{
  constructor({identity,authorizer,policyEngine,approvalStore,autonomyStore,audit,stateRoot=null,capabilityStatus=null}={}){
    Object.assign(this,{identity,authorizer,policyEngine,approvalStore,autonomyStore,audit,stateRoot});
    this.policyStore=new PolicyStore(stateRoot,audit);
    this.capabilityBoundary=new CapabilityBoundary({capabilityStatus});
    this.emergencyStop=new EmergencyStop(stateRoot,audit);
    this.auditIntegrity=new AuditIntegrity(audit);
    this.trustedDevices=new TrustedDeviceRegistry(stateRoot,audit);
    Object.freeze(this);
  }
  classifyGovernanceChange(changes=[]){return governanceChangeClass(changes);}
  status(auth=null){
    const raw=this.identity?.status(auth)||null;
    const identity=raw?{state:raw.state,identityConfigured:raw.identityConfigured,authenticated:raw.authenticated,identity:raw.identity,sessionHours:raw.sessionHours}:null;
    const trusted=this.trustedDevices.list(1000);
    return {
      state:"SUCCESS",authorityModel:"LOCAL_SELF_GOVERNED",governanceVersion:GOVERNANCE_VERSION,governanceSchemaVersion:GOVERNANCE_SCHEMA_VERSION,
      identity,policyDecisions:["ALLOW","DENY","ASK","ESCALATE","BLOCK"],externalGovernanceRequired:false,
      protectedRules:PROTECTED_GOVERNANCE_RULES,emergencyStop:this.emergencyStop.status(),
      auditIntegrity:this.auditIntegrity.verify(),trustedDevices:{count:trusted.length,independentOwnershipProof:trusted.some(x=>x.independentOwnershipProof===true)},
      principle:"AI and agents may propose or test changes; local identity, policy, approval, capability truth, evidence and protected-rule boundaries determine execution."
    };
  }
}
