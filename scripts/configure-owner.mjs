import path from "node:path";
import {fileURLToPath} from "node:url";
import {LocalIdentity} from "../src/governance/identity.js";
import {AuditLog} from "../src/audit.js";

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const stateRoot=process.env.IUV_STATE_DIR?path.resolve(process.env.IUV_STATE_DIR):path.join(root,"state");
const email=String(process.env.UAI_OWNER_EMAIL||"").trim();
const password=String(process.env.UAI_OWNER_PASSWORD||"");
const replace=process.argv.includes("--replace");

if(!email||!password){
  console.error(JSON.stringify({state:"BLOCKED",message:"Set UAI_OWNER_EMAIL and UAI_OWNER_PASSWORD in the local shell before running this command."},null,2));
  process.exit(2);
}
const audit=new AuditLog(stateRoot);
const identity=new LocalIdentity(stateRoot,audit);
const out=identity.configureOwner(email,password,{replace,credentialSource:"LOCAL_CLI"});
delete process.env.UAI_OWNER_PASSWORD;
const safe={...out};
if(safe.identity?.email)safe.identity={...safe.identity,email:safe.identity.email};
console.log(JSON.stringify(safe,null,2));
process.exit(out.state==="SUCCESS"?0:1);
