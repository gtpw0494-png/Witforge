import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import {PluginRegistry,pluginManifestDigest} from "../src/plugin-registry.js";
import {PluginExecutor} from "../src/plugin-executor.js";
import {PolicyEngine} from "../src/policy-engine.js";
import {LlamaCppRuntime} from "../src/model-runtime-adapter.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"uai-runtime-"));

// Signed plugins remain non-executable until the external sandbox is explicitly configured.
const {publicKey,privateKey}=crypto.generateKeyPairSync("ed25519");
const manifest={
  id:"fixture.plugin",
  name:"Fixture Plugin",
  version:"1.0.0",
  entrypoint:"fixture.js",
  capabilities:["knowledge.read"],
  permissions:{filesystem:{read:[],write:[]},network:{allow:[]},process:{spawn:false}},
  risk:"low",
  timeoutMs:2000,
  reversible:true,
  provenance:{source:"fixture",sha256:"0".repeat(64)}
};
manifest.signature={
  algorithm:"ed25519",
  publicKeyPem:publicKey.export({type:"spki",format:"pem"}),
  signatureBase64:crypto.sign(null,Buffer.from(pluginManifestDigest(manifest),"utf8"),privateKey).toString("base64")
};
const registry=new PluginRegistry(root);
assert.equal(registry.register(manifest).state,"SUCCESS");
assert.equal(registry.executionStatus("fixture.plugin").state,"UNAVAILABLE");

const oldSandbox=process.env.IUV_PLUGIN_SANDBOX_COMMAND;
process.env.IUV_PLUGIN_SANDBOX_COMMAND="cat >/dev/null; echo '{\"ok\":true,\"boundary\":\"sandbox\"}'";
try{
  assert.equal(registry.executionStatus("fixture.plugin").state,"CONFIGURED");
  const executor=new PluginExecutor({registry,policyEngine:new PolicyEngine()});
  const executed=await executor.execute("fixture.plugin",{query:"hello"});
  assert.equal(executed.state,"SUCCESS");
  assert.deepEqual(executed.result,{ok:true,boundary:"sandbox"});
}finally{
  if(oldSandbox===undefined)delete process.env.IUV_PLUGIN_SANDBOX_COMMAND;
  else process.env.IUV_PLUGIN_SANDBOX_COMMAND=oldSandbox;
}

// The llama.cpp adapter is tested against a local OpenAI-compatible fixture server.
const server=http.createServer((req,res)=>{
  res.setHeader("content-type","application/json");
  if(req.method==="GET"&&req.url==="/v1/models"){
    res.end(JSON.stringify({data:[{id:"fixture-model"}]}));
    return;
  }
  if(req.method==="POST"&&req.url==="/v1/chat/completions"){
    let body="";
    req.on("data",d=>body+=d);
    req.on("end",()=>{
      const parsed=JSON.parse(body||"{}");
      assert.equal(parsed.messages.at(-1).content,"hello runtime");
      res.end(JSON.stringify({
        model:"fixture-model",
        choices:[{message:{role:"assistant",content:"fixture response"}}],
        usage:{prompt_tokens:2,completion_tokens:2}
      }));
    });
    return;
  }
  res.statusCode=404;
  res.end(JSON.stringify({error:"not found"}));
});
await new Promise((resolve,reject)=>{
  server.once("error",reject);
  server.listen(0,"127.0.0.1",resolve);
});
const address=server.address();
assert.equal(typeof address,"object");

const oldUrl=process.env.LLAMA_SERVER_URL;
const oldRemote=process.env.IUV_ALLOW_REMOTE_MODEL_RUNTIME;
try{
  process.env.LLAMA_SERVER_URL=`http://127.0.0.1:${address.port}`;
  delete process.env.IUV_ALLOW_REMOTE_MODEL_RUNTIME;
  const runtime=new LlamaCppRuntime();
  const status=await runtime.status();
  assert.equal(status.availability,"CONNECTED");
  assert.equal(status.executable,true);
  assert.equal(status.models[0].id,"fixture-model");
  const chat=await runtime.chat("hello runtime",{model:"fixture-model",maxTokens:8});
  assert.equal(chat.state,"SUCCESS");
  assert.equal(chat.text,"fixture response");

  process.env.LLAMA_SERVER_URL="http://192.0.2.1:8080";
  const blocked=new LlamaCppRuntime();
  assert.equal((await blocked.status()).availability,"BLOCKED");
}finally{
  await new Promise(resolve=>server.close(resolve));
  if(oldUrl===undefined)delete process.env.LLAMA_SERVER_URL; else process.env.LLAMA_SERVER_URL=oldUrl;
  if(oldRemote===undefined)delete process.env.IUV_ALLOW_REMOTE_MODEL_RUNTIME; else process.env.IUV_ALLOW_REMOTE_MODEL_RUNTIME=oldRemote;
}

console.log("Plugin sandbox and llama.cpp runtime boundary tests passed");
