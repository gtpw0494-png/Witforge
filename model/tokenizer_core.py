"""Dependency-free tokenizer primitives shared by ForgeLM and tokenizer tooling."""
SPECIAL={"<|pad|>":256,"<|act|>":257,"<|obs|>":258,"<|end|>":259}
class ByteActionTokenizer:
    vocab_size=260
    def encode(self,text):
        text=str(text);out=[];i=0;keys=sorted(SPECIAL,key=len,reverse=True)
        while i<len(text):
            hit=next((k for k in keys if text.startswith(k,i)),None)
            if hit:
                out.append(SPECIAL[hit]);i+=len(hit);continue
            out.extend(text[i].encode('utf-8'));i+=1
        return out
    def decode(self,ids):
        rev={v:k for k,v in SPECIAL.items()};buf=bytearray();parts=[]
        def flush():
            nonlocal buf
            if buf:
                parts.append(buf.decode('utf-8',errors='replace'));buf=bytearray()
        for raw in ids:
            x=int(raw)
            if 0<=x<256:buf.append(x)
            elif x in rev:flush();parts.append(rev[x])
        flush();return ''.join(parts)
