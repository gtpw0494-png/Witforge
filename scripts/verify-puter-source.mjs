import fs from 'node:fs';import crypto from 'node:crypto';
const meta=JSON.parse(fs.readFileSync(new URL('../integrations/puter/PUTER-UPSTREAM.json',import.meta.url),'utf8'));
if(meta.commit!=='922d203e18e1946c83dca2fe3b179010fde0480c')throw new Error('Unexpected Puter pin');
if(meta.license!=='AGPL-3.0-only')throw new Error('Unexpected Puter license');
console.log(JSON.stringify({state:'SUCCESS',repository:meta.repository,commit:meta.commit,license:meta.license,metadataSha256:crypto.createHash('sha256').update(JSON.stringify(meta)).digest('hex')}));