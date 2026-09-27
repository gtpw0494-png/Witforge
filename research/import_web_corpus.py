#!/usr/bin/env python3
"""Streaming web-corpus importers for ForgeLM research/training.

Supported inputs:
- Common Crawl WET/WARC text files (.warc, .warc.gz, .wet, .wet.gz)
- Wikimedia/MediaWiki XML dumps (.xml, .xml.bz2)
- Stack Exchange Posts.xml / .7z-extracted XML
- FineWeb-style JSONL and optional Parquet

The importer never guesses a license. A source profile supplies the default license
state, and every output row carries its source, source_id, license and eligibility.
"""
from __future__ import annotations
import argparse,bz2,gzip,hashlib,html,json,re,sys,xml.etree.ElementTree as ET
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'model'/'data'/'web-corpus.jsonl'
REG=json.loads((ROOT/'research'/'web_source_registry.json').read_text())
PROFILES={x['id']:x for x in REG['sources']}
TAG_RE=re.compile(r'<[^>]+>')
SPACE_RE=re.compile(r'\s+')

def clean(x):
    x=html.unescape(str(x or ''))
    x=TAG_RE.sub(' ',x)
    return SPACE_RE.sub(' ',x).strip()

def digest_text(x):return hashlib.sha256(x.encode('utf-8')).hexdigest()

def eligibility(profile,license_override=None):
    lic=license_override or profile.get('license','UNKNOWN')
    state=profile.get('trainingEligibility','NOT_ELIGIBLE_BY_DEFAULT')
    return lic,state,state.startswith('ELIGIBLE')

def emit(rows,out,profile,license_override=None,limit=0,min_chars=80,training_approved=False):
    out.parent.mkdir(parents=True,exist_ok=True);seen=set();n=dup=short=0
    lic,elig_state,source_eligible=eligibility(profile,license_override);eligible=bool(source_eligible and training_approved)
    with out.open('a',encoding='utf-8') as f:
      for row in rows:
        text=clean(row.get('text'))
        if len(text)<min_chars:short+=1;continue
        d=digest_text(text)
        if d in seen:dup+=1;continue
        seen.add(d)
        rec={"format":"iu-web-record-v2","sourceClass":profile['id'],"source":profile['name'],"sourceId":str(row.get('sourceId','')),"url":row.get('url'),"license":lic,"licensePolicy":elig_state,"licenseVerified":bool(source_eligible),"retrievalEligible":True,"trainingApproved":bool(training_approved),"trainingEligible":eligible,"quarantineState":"PROMOTED" if eligible else "RESEARCH_ONLY","externalContent":True,"instructionAuthority":"NONE","sha256":d,"text":text}
        f.write(json.dumps(rec,ensure_ascii=False)+'\n');n+=1
        if limit and n>=limit:break
    return {"state":"SUCCESS","imported":n,"duplicates":dup,"tooShort":short,"output":str(out),"source":profile['id'],"license":lic,"sourceTrainingEligible":bool(source_eligible),"trainingApproved":bool(training_approved),"trainingEligible":eligible}

def open_maybe(path):
    if str(path).endswith('.gz'):return gzip.open(path,'rb')
    return open(path,'rb')

def iter_wet(path):
    with open_maybe(path) as f:
      while True:
        line=f.readline()
        if not line:break
        if not line.startswith(b'WARC/'):continue
        headers={}
        while True:
          line=f.readline()
          if not line or line in (b'\n',b'\r\n'):break
          try:k,v=line.decode('utf-8','replace').split(':',1);headers[k.strip().lower()]=v.strip()
          except ValueError:pass
        try:n=int(headers.get('content-length','0'))
        except:n=0
        body=f.read(n) if n>0 else b''
        if headers.get('warc-type') not in ('conversion','response'):continue
        text=body.decode('utf-8','replace')
        yield {'sourceId':headers.get('warc-record-id',''),'url':headers.get('warc-target-uri'),'text':text}

def iter_mediawiki(path):
    opener=bz2.open if str(path).endswith('.bz2') else open
    with opener(path,'rb') as f:
      for ev,elem in ET.iterparse(f,events=('end',)):
        if elem.tag.endswith('page'):
          title='';text='';pid=''
          for child in elem.iter():
            tag=child.tag.split('}')[-1]
            if tag=='title' and not title:title=child.text or ''
            elif tag=='id' and not pid:pid=child.text or ''
            elif tag=='text':text=child.text or ''
          yield {'sourceId':pid,'url':None,'text':f'{title}\n{text}'};elem.clear()

def iter_stack(path):
    with open(path,'rb') as f:
      for ev,elem in ET.iterparse(f,events=('end',)):
        if elem.tag=='row':
          a=elem.attrib;yield {'sourceId':a.get('Id',''),'url':None,'text':f"{a.get('Title','')}\n{a.get('Body','')}"};elem.clear()

def iter_jsonl(path,text_field='text',url_field='url',id_field='id'):
    with open(path,encoding='utf-8',errors='replace') as f:
      for i,line in enumerate(f,1):
        if not line.strip():continue
        try:r=json.loads(line)
        except:continue
        yield {'sourceId':r.get(id_field,i),'url':r.get(url_field),'text':r.get(text_field,'')}

def iter_parquet(path,text_field='text',url_field='url',id_field='id'):
    try:import pyarrow.parquet as pq
    except Exception as e:raise RuntimeError('Parquet import requires pyarrow (pip install pyarrow).') from e
    pf=pq.ParquetFile(path)
    for batch in pf.iter_batches(columns=[x for x in [text_field,url_field,id_field] if x in pf.schema.names],batch_size=2048):
      for i,r in enumerate(batch.to_pylist()):yield {'sourceId':r.get(id_field,i),'url':r.get(url_field),'text':r.get(text_field,'')}

def main():
    a=argparse.ArgumentParser();a.add_argument('--source',required=True,choices=sorted(PROFILES));a.add_argument('--input',type=Path,required=True);a.add_argument('--format',choices=['wet','mediawiki','stackexchange','jsonl','parquet']);a.add_argument('--output',type=Path,default=OUT);a.add_argument('--limit',type=int,default=0);a.add_argument('--min-chars',type=int,default=80);a.add_argument('--license');a.add_argument('--text-field',default='text');a.add_argument('--url-field',default='url');a.add_argument('--id-field',default='id');a.add_argument('--training-approved',action='store_true',help='Explicitly approve license-eligible imported records for training. Without this flag records remain research/retrieval only.');x=a.parse_args()
    fmt=x.format
    if not fmt:
      n=x.input.name.lower();fmt='wet' if '.wet' in n or '.warc' in n else 'mediawiki' if '.xml.bz2' in n and x.source=='wikimedia' else 'stackexchange' if n.endswith('.xml') and x.source=='stackexchange-dump' else 'parquet' if n.endswith('.parquet') else 'jsonl'
    rows={'wet':lambda:iter_wet(x.input),'mediawiki':lambda:iter_mediawiki(x.input),'stackexchange':lambda:iter_stack(x.input),'jsonl':lambda:iter_jsonl(x.input,x.text_field,x.url_field,x.id_field),'parquet':lambda:iter_parquet(x.input,x.text_field,x.url_field,x.id_field)}[fmt]()
    print(json.dumps(emit(rows,x.output,PROFILES[x.source],x.license,x.limit,x.min_chars,x.training_approved)))
if __name__=='__main__':main()
