#!/usr/bin/env node
import path from "node:path";
import {AuditLog} from "../src/audit.js";
import {MemoryStore} from "../src/memory/memory-store.js";
import {ProvenanceGraph} from "../src/provenance/graph.js";
import {PolicyEngine} from "../src/policy-engine.js";
import {PolicySimulator} from "../src/governance/policy-simulator.js";
import {EvaluationStore} from "../src/evaluation/evaluation-store.js";
import {ModelArtifactVerifier} from "../src/models/artifact-verifier.js";

const root=process.cwd(),stateRoot=path.resolve(process.env.IUV_STATE_DIR||path.join(root,"state")),audit=new AuditLog(stateRoot);
const memory=new MemoryStore({stateRoot,audit}),provenance=new ProvenanceGraph({stateRoot,audit,memoryStore:memory}),policy=new PolicySimulator({policyEngine:new PolicyEngine(),stateRoot,audit}),evaluations=new EvaluationStore({stateRoot,audit}),artifacts=new ModelArtifactVerifier({stateRoot,audit});
const [cmd,...args]=process.argv.slice(2);
let out;
if(cmd==="memory-status")out=memory.status(args[0]||null);
else if(cmd==="memory-list")out={state:"SUCCESS",items:memory.list({ownerId:args[0],limit:Number(args[1]||100)})};
else if(cmd==="memory-search")out=memory.search(args.slice(1).join(" "),{ownerId:args[0],limit:20});
else if(cmd==="remember")out=memory.remember({ownerId:args[0],namespace:"user",sourceId:"cli:explicit",text:args.slice(1).join(" "),consent:true,reason:"explicit local CLI remember",trainingAllowed:false});
else if(cmd==="provenance-status")out=provenance.status();
else if(cmd==="provenance-trace")out=provenance.trace(args[0]||"",{direction:"both",depth:Number(args[1]||6)});
else if(cmd==="policy-simulate")out=policy.simulate({actor:"cli:owner",objective:args.join(" "),steps:[{operation:"cli.proposed-workflow",description:args.join(" "),risk:/critical/i.test(args.join(" "))?"critical":/high/i.test(args.join(" "))?"high":"medium",external:/external|web|api|send|upload/i.test(args.join(" ")),mutatesSource:/source|code|modify/i.test(args.join(" "))}]});
else if(cmd==="evaluations")out=evaluations.status();
else if(cmd==="artifacts")out={state:"SUCCESS",artifacts:artifacts.list(Number(args[0]||100))};
else out={state:"SUCCESS",memory:memory.db.status(),memoryPolicy:{trainingDefault:false,encryption:memory.key?"AES_256_GCM":"PLAINTEXT_LOCAL"},provenance:provenance.status(),evaluations:evaluations.status(),modelArtifacts:{count:artifacts.list(10000).length},policySimulations:{count:policy.list(10000).length}};
console.log(JSON.stringify(out,null,2));
