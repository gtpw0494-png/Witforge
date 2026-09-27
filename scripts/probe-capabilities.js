#!/usr/bin/env node
import {RuntimeServices} from "../src/runtime-services.js";
import {LangGraphAdapter} from "../src/langgraph-adapter.js";
import {ForgeLMBridge} from "../src/forgelm-bridge.js";
async function localProbe(){const services=new RuntimeServices(),lg=new LangGraphAdapter(),fm=new ForgeLMBridge();return {state:"SUCCESS",mode:"local-process",runtimeServices:await services.probe(),langgraph:await lg.status(),forgelm:await fm.status(),note:"External CONNECTED observations in local-process mode live only for this probe. Start the server and POST /api/capabilities/probe (or ask OneChat to probe capabilities) to update the live server process."};}
try{
  const r=await fetch(process.env.IU_STATUS_URL||"http://127.0.0.1:8787/api/capabilities/probe",{method:"POST",headers:{"content-type":"application/json"},body:"{}",signal:AbortSignal.timeout(2500)});
  if(r.ok){const x=await r.json();console.log(JSON.stringify({state:"SUCCESS",mode:"live-server",...x},null,2));process.exit(0);}
}catch{}
console.log(JSON.stringify(await localProbe(),null,2));
