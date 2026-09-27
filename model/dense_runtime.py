#!/usr/bin/env python3
from __future__ import annotations
import json, os, sys

def emit(x): print(json.dumps(x,separators=(",",":"),ensure_ascii=False))
def config():
    return {
      "embedding_model": os.getenv("IUV_EMBEDDING_MODEL","").strip(),
      "reranker_model": os.getenv("IUV_RERANKER_MODEL","").strip(),
      "allow_downloads": os.getenv("IUV_ALLOW_MODEL_DOWNLOADS","0")=="1",
    }
def imports():
    try:
      from sentence_transformers import SentenceTransformer, CrossEncoder
      return SentenceTransformer,CrossEncoder,None
    except Exception as e:
      return None,None,str(e)
def main():
    req=json.load(sys.stdin);action=req.get("action","status");cfg=config();SentenceTransformer,CrossEncoder,error=imports()
    if action=="status":
      available=SentenceTransformer is not None
      emit({"state":"SUCCESS","backend":"sentence-transformers","packageAvailable":available,"embeddingConfigured":bool(cfg["embedding_model"]),"rerankerConfigured":bool(cfg["reranker_model"]),"allowDownloads":cfg["allow_downloads"],"embeddingAvailability":"CONFIGURED" if available and cfg["embedding_model"] else "UNAVAILABLE","rerankerAvailability":"CONFIGURED" if available and cfg["reranker_model"] else "UNAVAILABLE","message":None if available else error});return
    if SentenceTransformer is None:
      emit({"state":"UNAVAILABLE","message":"sentence-transformers is not installed.","detail":error});return
    local_only=not cfg["allow_downloads"]
    try:
      if action=="embed":
        if not cfg["embedding_model"]:emit({"state":"UNAVAILABLE","message":"IUV_EMBEDDING_MODEL is not configured."});return
        model=SentenceTransformer(cfg["embedding_model"],local_files_only=local_only)
        texts=[str(x) for x in req.get("texts") or []][:512]
        vecs=model.encode(texts,normalize_embeddings=True,convert_to_numpy=True)
        emit({"state":"SUCCESS","model":cfg["embedding_model"],"dimensions":int(vecs.shape[1]) if len(vecs) else None,"vectors":[v.tolist() for v in vecs]});return
      if action=="rerank":
        if not cfg["reranker_model"]:emit({"state":"UNAVAILABLE","message":"IUV_RERANKER_MODEL is not configured."});return
        model=CrossEncoder(cfg["reranker_model"],local_files_only=local_only)
        q=str(req.get("query") or "");texts=[str(x) for x in req.get("texts") or []][:512]
        scores=model.predict([[q,t] for t in texts])
        emit({"state":"SUCCESS","model":cfg["reranker_model"],"scores":[float(x) for x in scores]});return
      emit({"state":"BLOCKED","message":"Unknown dense runtime action."})
    except Exception as e:
      emit({"state":"UNAVAILABLE","message":"Configured neural retrieval runtime could not be loaded.","detail":str(e)[:2000]})
if __name__=="__main__":main()
