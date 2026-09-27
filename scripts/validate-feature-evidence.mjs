import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const file=path.join(root,'governance','feature-evidence.json');
const doc=JSON.parse(fs.readFileSync(file,'utf8'));
const allowed=new Set(doc.allowed_statuses||[]);
const errors=[];

if(doc.schema_version!=='uai-feature-evidence-v1') errors.push('unsupported schema_version');
const packageVersion=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
if(doc.generated_for!==packageVersion) errors.push(`feature evidence generated_for ${doc.generated_for} does not match package version ${packageVersion}`);
const ids=new Set();

for(const f of doc.features||[]){
  if(!f.id) errors.push('feature missing id');
  else if(ids.has(f.id)) errors.push(`duplicate feature id ${f.id}`);
  else ids.add(f.id);
  if(!allowed.has(f.status)) errors.push(`${f.id}: invalid status ${f.status}`);
  const impl=Array.isArray(f.implementation)?f.implementation:[];
  const tests=Array.isArray(f.tests)?f.tests:[];
  if(['IMPLEMENTED_UNVERIFIED_REPO','EXPERIMENTAL','PARTIAL','VERIFIED'].includes(f.status)&&impl.length===0) errors.push(`${f.id}: status ${f.status} requires implementation paths`);
  if(f.status==='VERIFIED'&&tests.length===0) errors.push(`${f.id}: VERIFIED requires tests`);
  if(f.status==='VERIFIED'){
    for(const p of impl){
      if(!fs.existsSync(path.join(root,p))) errors.push(`${f.id}: VERIFIED implementation path missing: ${p}`);
    }
    for(const t of tests){
      const filePart=String(t).split('::')[0];
      if(!fs.existsSync(path.join(root,filePart))) errors.push(`${f.id}: VERIFIED test path missing: ${filePart}`);
    }
  }
}

if(errors.length){
  console.error(JSON.stringify({state:'FAILURE',errors},null,2));
  process.exit(1);
}
console.log(JSON.stringify({state:'SUCCESS',features:(doc.features||[]).length,verified:(doc.features||[]).filter(x=>x.status==='VERIFIED').length},null,2));
