"""ForgeLM-native capability layer.

This module deliberately has no network/provider dependency. It turns ForgeLM into a
self-contained local assistant with deterministic prompt contracts for chat, coding,
planning, structured output, tool proposals, and local document reasoning. The neural
model remains the generator; this layer supplies safe local protocols around it.
"""
from __future__ import annotations
import ast, json, re
from dataclasses import dataclass
from typing import Any, Callable
try:
    from long_context import ForgeLongContext
except ModuleNotFoundError:
    from model.long_context import ForgeLongContext

TASKS = {"chat", "code", "reasoning", "planning", "json", "tool", "embeddings", "rerank", "long-context", "vision", "image"}

@dataclass
class ToolSpec:
    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Callable[[dict[str, Any]], Any] | None = None

class ForgeCapabilities:
    def __init__(self, model, tokenizer, tools=None):
        self.model, self.tokenizer = model, tokenizer
        self.tools = {t.name: t for t in (tools or [])}
        self.long_context_engine = ForgeLongContext(model, tokenizer)

    def status(self):
        return {"state":"SUCCESS", "engine":"ForgeLM", "selfSufficient":True,
                "networkRequired":False, "tasks":sorted(TASKS),
                "implemented":["chat","code","reasoning","planning","json","tool","embeddings","rerank","long-context"],
                "partial":["vision","image"],
                "truth":"Vision and image generation require a trained local multimodal encoder/decoder; no external model is silently used."}

    def _instruction(self, task, prompt, context=""):
        if task not in TASKS: raise ValueError(f"unknown task {task}; choose one of {sorted(TASKS)}")
        contracts = {
          "chat":"Answer directly. Do not invent sources or capabilities.",
          "code":"Return correct maintainable code. Explain assumptions and include tests when useful.",
          "reasoning":"Work through the problem carefully, check assumptions, then give a concise conclusion.",
          "planning":"Return an ordered plan with prerequisites, risks, verification, and rollback.",
          "json":"Return only valid JSON matching the requested shape. No markdown fences.",
          "tool":"Return a JSON tool proposal only; never claim that a tool ran.",
          "embeddings":"Return local semantic embedding evidence from the promoted ForgeLM checkpoint.",
          "rerank":"Rank supplied local documents against the query using ForgeLM embedding similarity.",
          "long-context":"Retrieve and assemble relevant evidence from text larger than the active attention window using ForgeLM embeddings only.",
          "vision":"Describe only locally supplied image observations; report unavailable when no local vision encoder exists.",
          "image":"Return an image-generation plan or local renderer instruction; do not claim pixels were generated unless a local renderer is installed."
        }
        return f"<|act|>TASK={task}\nCONTRACT={contracts[task]}\nCONTEXT={context}\nUSER={prompt}\n<|obs|>"

    def prompt(self, task, prompt, context=""):
        return self._instruction(task, str(prompt), str(context))

    def validate_json(self, text, schema=None):
        try: value=json.loads(text)
        except json.JSONDecodeError as e: return {"state":"FAILURE","message":f"invalid JSON: {e}"}
        if schema:
            if schema.get("type")=="object" and not isinstance(value,dict): return {"state":"FAILURE","message":"expected JSON object"}
            missing=[x for x in schema.get("required",[]) if x not in value]
            if missing:return {"state":"FAILURE","message":f"missing required fields: {missing}"}
        return {"state":"SUCCESS","value":value}


    def embed_texts(self, texts):
        import torch
        rows=[]
        for text in (texts if isinstance(texts,list) else [texts]):
            ids=self.tokenizer.encode(str(text))[:self.model.config.max_seq_len]
            if not ids: ids=[0]
            tensor=torch.tensor([ids],dtype=torch.long,device=next(self.model.parameters()).device)
            vector=self.model.embed(tensor)[0].detach().cpu().tolist()
            rows.append(vector)
        return {"state":"SUCCESS","engine":"ForgeLM","embeddings":rows,"dimensions":len(rows[0]) if rows else 0,"normalized":True,"externalModels":False}

    def rerank(self, query, documents):
        import math
        if not isinstance(documents,list) or not documents:return {"state":"BLOCKED","message":"rerank requires a non-empty document list"}
        vectors=self.embed_texts([str(query),*map(str,documents)])["embeddings"];q=vectors[0]
        scored=[]
        for i,v in enumerate(vectors[1:]):
            score=sum(a*b for a,b in zip(q,v));scored.append({"index":i,"score":float(score),"document":documents[i]})
        scored.sort(key=lambda x:(-x["score"],x["index"]))
        return {"state":"SUCCESS","engine":"ForgeLM","query":str(query),"results":scored,"externalModels":False}

    def long_context(self, query, source_text, top_k=4, token_budget=None):
        result=self.long_context_engine.assemble(str(query),str(source_text),top_k=int(top_k),token_budget=token_budget)
        if result.get("state")!="SUCCESS":return result
        return {**result,"networkRequired":False,"externalModels":False,"truth":"This extends usable context through ForgeLM-native retrieval memory; it does not claim the transformer attention window itself equals the full source length."}

    def inspect_code(self, source, language="python"):
        if language.lower() not in ("python","py"): return {"state":"PARTIAL","language":language,"message":"Only Python AST inspection is currently local and built in."}
        try:
            tree=ast.parse(source); imports=[n.names[0].name for n in ast.walk(tree) if isinstance(n,ast.Import) and n.names]
            funcs=[n.name for n in ast.walk(tree) if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))]
            classes=[n.name for n in ast.walk(tree) if isinstance(n,ast.ClassDef)]
            return {"state":"SUCCESS","language":"python","syntax":"valid","imports":imports,"functions":funcs,"classes":classes}
        except SyntaxError as e:return {"state":"FAILURE","language":"python","syntax":"invalid","line":e.lineno,"message":e.msg}

    def plan(self, objective):
        return {"state":"SUCCESS","task":"planning","objective":str(objective),"steps":[
            {"id":"understand","action":"define inputs, outputs, constraints"},
            {"id":"implement","action":"make the smallest local change"},
            {"id":"verify","action":"run deterministic tests and inspect evidence"},
            {"id":"rollback","action":"retain a reversible checkpoint"}],"externalModels":False}

    def propose_tool(self, name, arguments):
        spec=self.tools.get(name)
        if not spec:return {"state":"DENIED","message":f"tool is not registered: {name}"}
        if not isinstance(arguments,dict):return {"state":"FAILURE","message":"tool arguments must be an object"}
        return {"state":"PROPOSED","tool":name,"arguments":arguments,"requiresApproval":True,"executed":False}

    def execute_tool(self, name, arguments, approved=False):
        proposal=self.propose_tool(name,arguments)
        if proposal["state"]!="PROPOSED":return proposal
        if not approved:return {**proposal,"state":"ASK","message":"owner approval required"}
        if not self.tools[name].handler:return {"state":"UNAVAILABLE","message":"tool has no local handler"}
        return {"state":"SUCCESS","tool":name,"result":self.tools[name].handler(arguments),"executed":True}
