const fs = require('fs');
const path = require('path');
const raw = fs.readFileSync(path.join(__dirname, '..', 'Witforge.txt'), 'utf8');
const lines = raw.split('\n');
const secs = [];
lines.forEach((l, i) => {
  const m = l.match(/^(\d{1,3})\.\s+([A-Z0-9][A-Z0-9 ,+&\/()\-'’]+)\s*$/);
  if (m) secs.push({ n: Number(m[1]), title: m[2].trim(), line: i });
});
secs.sort((a, b) => a.n - b.n);
for (let i = 0; i < secs.length; i++) {
  const start = secs[i].line;
  const end = i + 1 < secs.length ? secs[i + 1].line : lines.length;
  secs[i].body = lines.slice(start + 1, end).join('\n').replace(/───/g, '').trim();
}
const reg = require(path.join(__dirname, '..', 'spec-coverage.js')).SECTIONS;
console.log('parsed from Witforge.txt:', secs.length);
console.log('registry entries:', reg.length);
const regNums = new Set(reg.map(r => r.n));
const specNums = new Set(secs.map(s => s.n));
console.log('missing from registry:', secs.filter(s => !regNums.has(s.n)).map(s => s.n));
console.log('extra in registry:', reg.filter(r => !specNums.has(r.n)).map(r => r.n));
const tm = secs.filter(s => { const r = reg.find(x => x.n === s.n); return r && r.t !== s.title; })
  .map(s => ({ n: s.n, spec: s.title, reg: (reg.find(x => x.n === s.n) || {}).t }));
console.log('title mismatches:', JSON.stringify(tm));
fs.writeFileSync(path.join(__dirname, 'spec-sections.json'), JSON.stringify(secs, null, 1));
const byStatus = {};
reg.forEach(r => byStatus[r.status] = (byStatus[r.status] || 0) + 1);
console.log('registry status counts:', byStatus);
