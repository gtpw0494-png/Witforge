#!/usr/bin/env python3
"""ForgeLM tokenizer abstraction.

Supports the dependency-free byte/action tokenizer, optional SentencePiece BPE,
and a dependency-free learned byte n-gram tokenizer for Termux portability.
"""
from __future__ import annotations
import hashlib,json
from collections import Counter
from pathlib import Path
try:
 from tokenizer_core import ByteActionTokenizer,SPECIAL
except ModuleNotFoundError:
 from model.tokenizer_core import ByteActionTokenizer,SPECIAL
ROOT=Path(__file__).resolve().parent
TOKDIR=ROOT/'tokenizers';DEFAULT_MODEL=TOKDIR/'forgelm.model';PY_MODEL=TOKDIR/'forgelm.pyngram.json'

class SentencePieceActionTokenizer:
 def __init__(self,model_path=DEFAULT_MODEL):
  import sentencepiece as spm
  self.model_path=Path(model_path);self.sp=spm.SentencePieceProcessor(model_file=str(self.model_path));self.vocab_size=self.sp.get_piece_size()
  self.end_id=int(self.sp.piece_to_id('<|end|>'))
 def encode(self,text):return self.sp.encode(str(text),out_type=int)
 def decode(self,ids):return self.sp.decode([int(x) for x in ids])

class PythonNgramActionTokenizer:
 def __init__(self,path=PY_MODEL):
  self.model_path=Path(path);d=json.loads(self.model_path.read_text());self.tokens=[bytes.fromhex(x) for x in d.get('tokens',[])];self.vocab_size=260+len(self.tokens);self.end_id=SPECIAL['<|end|>']
  self.by_first={}
  for i,b in enumerate(self.tokens,260):
   if b:self.by_first.setdefault(b[0],[]).append((b,i))
  for k in self.by_first:self.by_first[k].sort(key=lambda x:len(x[0]),reverse=True)
 def _encode_bytes(self,b):
  out=[];i=0
  while i<len(b):
   hit=None
   for token,tid in self.by_first.get(b[i],[]):
    if b.startswith(token,i):hit=(token,tid);break
   if hit:out.append(hit[1]);i+=len(hit[0])
   else:out.append(b[i]);i+=1
  return out
 def encode(self,text):
  text=str(text);out=[];i=0;keys=sorted(SPECIAL,key=len,reverse=True)
  while i<len(text):
   hit=next((k for k in keys if text.startswith(k,i)),None)
   if hit:out.append(SPECIAL[hit]);i+=len(hit);continue
   j=i+1
   while j<len(text) and not any(text.startswith(k,j) for k in keys):j+=1
   out.extend(self._encode_bytes(text[i:j].encode('utf-8')));i=j
  return out
 def decode(self,ids):
  rev={v:k for k,v in SPECIAL.items()};parts=[];buf=bytearray()
  def flush():
   nonlocal buf
   if buf:parts.append(buf.decode('utf-8',errors='replace'));buf=bytearray()
  for raw in ids:
   x=int(raw)
   if 0<=x<256:buf.append(x)
   elif x in rev:flush();parts.append(rev[x])
   elif 260<=x<self.vocab_size:buf.extend(self.tokens[x-260])
  flush();return ''.join(parts)

def tokenizer_info(tok):
 if isinstance(tok,SentencePieceActionTokenizer):
  p=tok.model_path;return {'type':'sentencepiece','path':str(p.relative_to(ROOT.parent) if p.is_relative_to(ROOT.parent) else p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'vocabSize':tok.vocab_size,'endId':tok.end_id}
 if isinstance(tok,PythonNgramActionTokenizer):
  p=tok.model_path;return {'type':'python-byte-ngram','path':str(p.relative_to(ROOT.parent) if p.is_relative_to(ROOT.parent) else p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'vocabSize':tok.vocab_size,'endId':tok.end_id}
 return {'type':'byte-action','vocabSize':tok.vocab_size,'endId':SPECIAL['<|end|>']}

def load_tokenizer(spec=None):
 if spec in ('byte','byte-action'):return ByteActionTokenizer()
 if spec in (None,'','auto'):
  if PY_MODEL.exists():return PythonNgramActionTokenizer(PY_MODEL)
  if DEFAULT_MODEL.exists():
   try:return SentencePieceActionTokenizer(DEFAULT_MODEL)
   except Exception:pass
  return ByteActionTokenizer()
 p=Path(spec)
 if not p.is_absolute():
  candidate=ROOT.parent/p;p=candidate if candidate.exists() else ROOT/p
 if p.suffix.lower()=='.json':return PythonNgramActionTokenizer(p)
 return SentencePieceActionTokenizer(p)

def train_sentencepiece(corpus:Path,output_prefix:Path=DEFAULT_MODEL.with_suffix(''),vocab_size=512):
 import sentencepiece as spm
 output_prefix=Path(output_prefix);output_prefix.parent.mkdir(parents=True,exist_ok=True)
 spm.SentencePieceTrainer.train(input=str(corpus),model_prefix=str(output_prefix),vocab_size=int(vocab_size),model_type='bpe',character_coverage=1.0,byte_fallback=True,hard_vocab_limit=False,pad_id=0,pad_piece='<|pad|>',unk_id=1,bos_id=-1,eos_id=-1,user_defined_symbols=['<|act|>','<|obs|>','<|end|>'],normalization_rule_name='identity')
 return tokenizer_info(SentencePieceActionTokenizer(str(output_prefix)+'.model'))

def train_python_ngram(corpus:Path,output:Path=PY_MODEL,vocab_size=512,max_bytes=4_000_000):
 raw=Path(corpus).read_bytes()[:max_bytes];want=max(0,int(vocab_size)-260);counts=Counter()
 for n in (2,3,4):
  counts.update(raw[i:i+n] for i in range(max(0,len(raw)-n+1)))
 tokens=[]
 for token,count in counts.most_common():
  if count<2:break
  if token in tokens:continue
  tokens.append(token)
  if len(tokens)>=want:break
 output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
 payload={'format':'ForgeLM-PythonNgram-1','base':'utf8-bytes+action-tokens','tokens':[x.hex() for x in tokens],'trainingBytes':len(raw),'requestedVocabSize':int(vocab_size)}
 output.write_text(json.dumps(payload,separators=(',',':')))
 return tokenizer_info(PythonNgramActionTokenizer(output))

def train_auto(corpus,vocab_size,engine='auto'):
 if engine in ('auto','sentencepiece'):
  try:return train_sentencepiece(corpus,DEFAULT_MODEL.with_suffix(''),vocab_size)
  except (ImportError,ModuleNotFoundError):
   if engine=='sentencepiece':raise
 return train_python_ngram(corpus,PY_MODEL,vocab_size)

if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();sp=p.add_subparsers(dest='cmd',required=True);t=sp.add_parser('train');t.add_argument('--corpus',type=Path,default=ROOT/'data'/'training-corpus.txt');t.add_argument('--vocab-size',type=int,default=512);t.add_argument('--engine',choices=['auto','sentencepiece','python-ngram'],default='auto');sp.add_parser('status');a=p.parse_args()
 if a.cmd=='train':
  try:print(json.dumps({'state':'SUCCESS',**train_auto(a.corpus,a.vocab_size,a.engine)}))
  except Exception as e:print(json.dumps({'state':'FAILURE','message':str(e)}));raise SystemExit(1)
 else:
  tok=load_tokenizer('auto');info=tokenizer_info(tok);print(json.dumps({'state':'SUCCESS',**info,'fallback':info['type']=='byte-action'}))
