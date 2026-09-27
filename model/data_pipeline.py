#!/usr/bin/env python3
"""ForgeLM data fabric.

Builds deterministic, provenance-bearing training corpora from local text/JSONL
inputs. It does not download data, infer licenses, or silently include failed /
unverified records.
"""
from __future__ import annotations
import argparse, hashlib, json, random, re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"

@dataclass
class Example:
    instruction: str
    response: str
    source: str
    source_id: str = ""
    truth_state: str = "SUCCESS"
    license: str = "USER_OR_PROJECT_DATA"
    kind: str = "instruction"

    def canonical(self) -> str:
        return f"{self.instruction.strip()}\n{self.response.strip()}".strip()

    def digest(self) -> str:
        return hashlib.sha256(self.canonical().encode("utf-8")).hexdigest()


def normalize_text(text: str) -> str:
    text = str(text).replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[\t ]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def load_verified_traces(path: Path) -> Iterable[Example]:
    if not path.exists():
        return []
    out=[]
    for line_no,line in enumerate(path.read_text(encoding="utf-8").splitlines(),1):
        if not line.strip():
            continue
        try: row=json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("truthState") != "SUCCESS":
            continue
        prov=row.get("provenance") or {}
        out.append(Example(
            instruction=normalize_text(row.get("instruction","")),
            response=normalize_text(row.get("response","")),
            source=str(prov.get("source") or "verified-traces"),
            source_id=str(prov.get("knowledgeId") or row.get("id") or f"line-{line_no}"),
            truth_state="SUCCESS",
            license="USER_OR_PROJECT_DATA",
            kind="verified-trace",
        ))
    return out


def load_text(path: Path, source: str | None=None) -> Iterable[Example]:
    text=normalize_text(path.read_text(encoding="utf-8", errors="replace"))
    if not text:
        return []
    # Paragraph-sized chunks are intentionally simple and inspectable.
    chunks=[x.strip() for x in re.split(r"\n\s*\n",text) if x.strip()]
    return [Example(
        instruction="Continue or explain this verified local training text.",
        response=x,
        source=source or str(path),
        source_id=f"{path.name}:{i}",
        kind="local-text",
    ) for i,x in enumerate(chunks)]


def load_web_corpus(path: Path, max_records: int=5000) -> Iterable[Example]:
    """Load only explicitly training-eligible web records.

    max_records bounds memory use on Termux. Large corpora should be imported/sharded
    and trained over successive deterministic windows instead of loading petabytes at once.
    """
    if not path.exists():
        return []
    out=[]
    for line_no,line in enumerate(path.open(encoding="utf-8",errors="replace"),1):
        if not line.strip():continue
        try: row=json.loads(line)
        except json.JSONDecodeError:continue
        if row.get("trainingEligible") is not True or row.get("trainingApproved") is not True:continue
        text=normalize_text(row.get("text",""))
        if not text:continue
        source=str(row.get("sourceClass") or row.get("source") or "web")
        source_id=str(row.get("sourceId") or row.get("sha256") or f"line-{line_no}")
        lic=str(row.get("license") or "UNKNOWN")
        out.append(Example(instruction="Continue, explain, or answer using this sourced web material.",response=text,source=source,source_id=source_id,truth_state="SUCCESS",license=lic,kind="web-corpus"))
        if max_records and len(out)>=max_records:break
    return out




def load_language_database(path: Path) -> Iterable[Example]:
    if not path.exists():
        return []
    out=[]
    for line_no,line in enumerate(path.open(encoding="utf-8",errors="replace"),1):
        if not line.strip():
            continue
        try: row=json.loads(line)
        except json.JSONDecodeError:
            continue
        if str(row.get("truth_state") or row.get("truthState") or "SUCCESS") != "SUCCESS":
            continue
        instruction=normalize_text(row.get("instruction","")); response=normalize_text(row.get("response",""))
        if not instruction or not response:
            continue
        out.append(Example(instruction=instruction,response=response,source=str(row.get("source") or "language-database"),source_id=str(row.get("source_id") or row.get("sourceId") or f"line-{line_no}"),truth_state="SUCCESS",license=str(row.get("license") or "UNKNOWN"),kind=str(row.get("kind") or "language-database")))
    return out

def deduplicate(examples: Iterable[Example]):
    seen=set(); kept=[]; rejected=[]
    for e in examples:
        if not e.instruction and not e.response:
            rejected.append({"reason":"empty","source":e.source,"sourceId":e.source_id});continue
        d=e.digest()
        if d in seen:
            rejected.append({"reason":"exact-duplicate","source":e.source,"sourceId":e.source_id,"sha256":d});continue
        seen.add(d);kept.append((d,e))
    return kept,rejected


def render(e: Example) -> str:
    return f"User: {e.instruction}\nAssistant: {e.response} <|end|>"


def build_dataset(trace_path: Path, extra_paths: list[Path], output_dir: Path, seed: int=7, validation_fraction: float=.1, web_corpus: Path|None=None, max_web_records: int=5000, language_database: Path|None=None):
    examples=list(load_verified_traces(trace_path))
    web_examples=list(load_web_corpus(web_corpus,max_web_records)) if web_corpus else []
    examples.extend(web_examples)
    language_examples=list(load_language_database(language_database)) if language_database else []
    examples.extend(language_examples)
    for p in extra_paths:
        if p.exists() and p.is_file(): examples.extend(load_text(p))
    kept,rejected=deduplicate(examples)
    rnd=random.Random(seed);rnd.shuffle(kept)
    n_val=0 if len(kept)<5 else max(1,int(round(len(kept)*validation_fraction)))
    val=kept[:n_val];train=kept[n_val:]
    output_dir.mkdir(parents=True,exist_ok=True)
    train_path=output_dir/"train.jsonl";val_path=output_dir/"validation.jsonl";manifest_path=output_dir/"manifest.json"
    def write(rows,path):
        with path.open("w",encoding="utf-8") as f:
            for digest,e in rows:
                f.write(json.dumps({"sha256":digest,**asdict(e),"text":render(e)},ensure_ascii=False)+"\n")
    write(train,train_path);write(val,val_path)
    manifest={
        "format":"forgelm-dataset-v2","seed":seed,"validationFraction":validation_fraction,
        "counts":{"input":len(examples),"accepted":len(kept),"train":len(train),"validation":len(val),"rejected":len(rejected),"webEligibleLoaded":len(web_examples),"languageDatabaseLoaded":len(language_examples)},
        "inputs":[str(trace_path),*[str(x) for x in extra_paths],*([str(web_corpus)] if web_corpus else []),*([str(language_database)] if language_database else [])],
        "files":{"train":str(train_path),"validation":str(val_path)},
        "integrity":{
            "trainSha256":hashlib.sha256(train_path.read_bytes()).hexdigest(),
            "validationSha256":hashlib.sha256(val_path.read_bytes()).hexdigest(),
        },
        "policy":"Verified traces require SUCCESS. Web records require both trainingEligible=true and trainingApproved=true; retrieval eligibility never implies training permission. Licenses are never inferred automatically. maxWebRecords bounds memory use for local/Termux builds.",
        "web":{"path":str(web_corpus) if web_corpus else None,"maxRecords":max_web_records},
        "rejected":rejected[:100],
    }
    manifest_path.write_text(json.dumps(manifest,indent=2),encoding="utf-8")
    return manifest


def main():
    p=argparse.ArgumentParser();p.add_argument("--traces",type=Path,default=DATA/"verified-traces.jsonl");p.add_argument("--extra",action="append",default=[]);p.add_argument("--web-corpus",type=Path,default=DATA/"web-corpus.jsonl");p.add_argument("--max-web-records",type=int,default=5000);p.add_argument("--language-database",type=Path,default=DATA/"language-database.jsonl");p.add_argument("--output",type=Path,default=DATA/"dataset-v2");p.add_argument("--seed",type=int,default=7);p.add_argument("--validation-fraction",type=float,default=.1);a=p.parse_args()
    result=build_dataset(a.traces,[Path(x) for x in a.extra],a.output,a.seed,a.validation_fraction,a.web_corpus,a.max_web_records,a.language_database)
    print(json.dumps({"state":"SUCCESS",**result}))
if __name__=="__main__":main()
