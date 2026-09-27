import crypto from "node:crypto";
import {GovernanceDb} from "../governance-db.js";
const OWNER_ID="owner-local";
const hash=x=>crypto.createHash("sha256").update(String(x||"")).digest("hex");
const eqHex=(a,b)=>{try{const x=Buffer.from(String(a||""),"hex"),y=Buffer.from(String(b||""),"hex");return x.length===y.length&&x.length>0&&crypto.timingSafeEqual(x,y);}catch{return false;}};
const cookies=req=>Object.fromEntries(String(req.headers?.cookie||"").split(";").map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf("=");return i<0?[x,""]:[x.slice(0,i),decodeURIComponent(x.slice(i+1))];}));
const derive=(password,salt)=>crypto.scryptSync(String(password),Buffer.from(salt,"hex"),64).toString("hex");
export class LocalIdentity{
 constructor(stateRoot,audit=null,{sessionHours=Number(process.env.IUV_SESSION_HOURS||12)}={}){
  this.audit=audit;this.db=new GovernanceDb(stateRoot);this.sessionMs=Math.max(5,Math.min(168,Number(sessionHours)||12))*3600000;
 }
 status(auth=null){const o=this.db.get("identity",OWNER_ID).record;return {state:"SUCCESS",identityConfigured:Boolean(o?.passwordHash),enrollmentRequired:!o?.passwordHash,authenticated:Boolean(auth?.authenticated),authenticationMode:"email-password-session",legacyBearerTokenAccepted:false,identity:auth?.authenticated?{id:auth.identityId,role:auth.role,email:o?.email||null,authMode:auth.authMode}:null,sessionHours:this.sessionMs/3600000};}
 enroll(email,password,{credentialSource="FIRST_RUN"}={}){
  const current=this.db.get("identity",OWNER_ID);if(current.record?.passwordHash)return {state:"DENIED",message:"Owner enrollment is already complete."};
  email=String(email||"").trim().toLowerCase();password=String(password||"");
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return {state:"BLOCKED",message:"A valid email is required."};
  if(password.length<12)return {state:"BLOCKED",message:"Password must contain at least 12 characters."};
  const source=String(credentialSource||"FIRST_RUN").slice(0,64);
  const salt=crypto.randomBytes(16).toString("hex"),rec={id:OWNER_ID,email,role:"owner",scopes:["*"],passwordSalt:salt,passwordHash:derive(password,salt),status:"ACTIVE",createdAt:new Date().toISOString(),credentialSource:source};
  const r=current.record?this.db.cas("identity",OWNER_ID,current.version,rec,{type:"credential-migration"}):this.db.create("identity",rec);
  if(r.state!=="SUCCESS")return {state:r.state,message:r.message||"Owner enrollment failed."};
  this.audit?.append({type:"identity.owner.enrolled",identityId:OWNER_ID,credentialSource:source});return {state:"SUCCESS",message:"Owner account created.",identity:{id:OWNER_ID,email,role:"owner"},credentialSource:source};
 }
 bootstrapFromEnvironment(env=process.env){
  const current=this.status();if(current.identityConfigured)return {state:"SUCCESS",bootstrapped:false,message:"Owner identity is already configured."};
  const email=String(env.UAI_OWNER_EMAIL||"").trim(),password=String(env.UAI_OWNER_PASSWORD||"");
  if(!email&&!password)return {state:"UNAVAILABLE",bootstrapped:false,message:"Owner bootstrap environment variables are not configured."};
  if(!email||!password)return {state:"BLOCKED",bootstrapped:false,message:"Both UAI_OWNER_EMAIL and UAI_OWNER_PASSWORD are required for owner bootstrap."};
  const r=this.enroll(email,password,{credentialSource:"ENV_BOOTSTRAP"});
  if(r.state==="SUCCESS"){this.audit?.append({type:"identity.owner.bootstrap",identityId:OWNER_ID,source:"environment"});return {...r,bootstrapped:true};}
  return {...r,bootstrapped:false};
 }
 configureOwner(email,password,{replace=false,credentialSource="LOCAL_CLI"}={}){
  email=String(email||"").trim().toLowerCase();password=String(password||"");
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return {state:"BLOCKED",message:"A valid email is required."};
  if(password.length<12)return {state:"BLOCKED",message:"Password must contain at least 12 characters."};
  const current=this.db.get("identity",OWNER_ID);
  if(current.record?.passwordHash&&!replace)return {state:"DENIED",message:"Owner identity already exists. Re-run with explicit replace authorization."};
  if(!current.record?.passwordHash)return this.enroll(email,password,{credentialSource});
  const salt=crypto.randomBytes(16).toString("hex");
  const rec={...current.record,email,passwordSalt:salt,passwordHash:derive(password,salt),status:"ACTIVE",credentialSource:String(credentialSource||"LOCAL_CLI").slice(0,64),credentialsUpdatedAt:new Date().toISOString()};
  const r=this.db.cas("identity",OWNER_ID,current.version,rec,{type:"credential-rotation"});
  if(r.state!=="SUCCESS")return {state:r.state,message:r.message||"Owner credential update failed."};
  let revoked=0;
  for(const s of this.db.list("session",10000).records||[]){
    if(s.identityId!==OWNER_ID||s.status!=="ACTIVE"||!Number.isFinite(Number(s._version)))continue;
    const { _version,...body }=s;
    const rr=this.db.cas("session",s.id,_version,{...body,status:"REVOKED",revokedAt:new Date().toISOString(),revokeReason:"owner-credential-rotation"},{type:"credential-rotation-revoke"});
    if(rr.state==="SUCCESS")revoked++;
  }
  this.audit?.append({type:"identity.owner.credentials.rotated",identityId:OWNER_ID,credentialSource:rec.credentialSource,revokedSessions:revoked});
  return {state:"SUCCESS",message:"Owner credentials updated and active sessions revoked.",identity:{id:OWNER_ID,email,role:"owner"},revokedSessions:revoked,credentialSource:rec.credentialSource};
 }
 verify(email,password){const o=this.db.get("identity",OWNER_ID).record;if(!o?.passwordHash||o.status!=="ACTIVE"||String(email||"").trim().toLowerCase()!==o.email)return false;return eqHex(derive(password,o.passwordSalt),o.passwordHash);}
 login(email,password){if(!this.verify(email,password))return {state:"DENIED",message:"Email or password is invalid."};const sessionToken=crypto.randomBytes(32).toString("base64url"),csrfToken=crypto.randomBytes(24).toString("base64url"),now=Date.now(),id="session-"+hash(sessionToken),session={id,identityId:OWNER_ID,role:"owner",scopes:["*"],csrfHash:hash(csrfToken),status:"ACTIVE",createdAt:new Date(now).toISOString(),expiresAt:new Date(now+this.sessionMs).toISOString()};const r=this.db.create("session",session);if(r.state!=="SUCCESS")return {state:"ERROR",message:r.message||"Failed to create session."};this.audit?.append({type:"identity.login",identityId:OWNER_ID,sessionId:id});return {state:"SUCCESS",message:"Owner session created.",sessionToken,csrfToken,identity:{id:OWNER_ID,role:"owner",email:String(email).trim().toLowerCase()},expiresAt:session.expiresAt};}
 authenticateRequest(req){const sessionToken=cookies(req).uai_session;if(!sessionToken)return {authenticated:false,reason:"No owner session."};const id="session-"+hash(sessionToken),s=this.db.get("session",id).record;if(!s||s.status!=="ACTIVE")return {authenticated:false,reason:"Session unavailable."};if(Date.now()>Date.parse(s.expiresAt||0))return {authenticated:false,reason:"Session expired."};return {authenticated:true,identityId:s.identityId,role:s.role,scopes:s.scopes||[],authMode:"session",csrfRequired:true,sessionId:id,csrfHash:s.csrfHash};}
 verifyCsrf(auth,token){return Boolean(auth?.authenticated&&auth.authMode==="session"&&eqHex(hash(token),auth.csrfHash));}
 logout(req){const a=this.authenticateRequest(req);if(!a.authenticated||!a.sessionId)return {state:"SUCCESS",message:"No active session."};const c=this.db.get("session",a.sessionId);if(!c.record)return {state:"SUCCESS",message:"Session unavailable."};const r=this.db.cas("session",a.sessionId,c.version,{...c.record,status:"REVOKED",revokedAt:new Date().toISOString()},{type:"revoke"});this.audit?.append({type:"identity.logout",identityId:a.identityId,sessionId:a.sessionId});return {state:r.state==="SUCCESS"?"SUCCESS":r.state,message:r.state==="SUCCESS"?"Owner session revoked.":r.message};}
}
export function sessionCookies(login,{secure=false}={}){const maxAge=Math.max(1,Math.floor((Date.parse(login.expiresAt)-Date.now())/1000)),s=secure?"; Secure":"";return [`uai_session=${encodeURIComponent(login.sessionToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${s}`,`uai_csrf=${encodeURIComponent(login.csrfToken)}; SameSite=Strict; Path=/; Max-Age=${maxAge}${s}`];}
export function clearSessionCookies({secure=false}={}){const s=secure?"; Secure":"";return [`uai_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${s}`,`uai_csrf=; SameSite=Strict; Path=/; Max-Age=0${s}`];}
