const DEFINITIONS = [
  {id:"research.openai.gpt_oss",match:"OpenAI gpt-oss",required:["REFERENCE_APPROVED"],reason:"Public OpenAI gpt-oss source/open-weight reference tracked for ForgeLM architecture research."},
  {id:"research.xai.grok1",match:"xAI Grok-1",required:["REFERENCE_APPROVED"],reason:"Public Grok-1 source/weights reference tracked for architecture research."},
  {id:"research.deepseek.v3",match:"DeepSeek-V3 code",required:["REFERENCE_APPROVED_CODE"],reason:"Public DeepSeek-V3 code reference tracked with code/model licensing kept separate."},
  {id:"research.google.gemma",match:"Google DeepMind Gemma",required:["REFERENCE_APPROVED"],reason:"Public Gemma implementation tracked as a Google/DeepMind architecture reference."},
  {id:"research.huggingface.transformers",match:"Hugging Face Transformers",required:["DEPENDENCY_APPROVED"],reason:"Apache-2.0 Transformers implementation tracked for model interoperability research."},
  {id:"research.anthropic.public",match:"Claude model",required:["PUBLIC_RESEARCH_ONLY"],reason:"Anthropic public repositories/research can be studied; Claude model source is not claimed."}
];
export function buildSourceResearchCapabilities(sourceRegistry=[]){
  return DEFINITIONS.map(def=>{
    const src=sourceRegistry.find(x=>x.name===def.match);
    const ok=Boolean(src&&def.required.includes(src.status)&&src.url);
    return {id:def.id,availability:ok?"CONNECTED":"UNAVAILABLE",executable:ok,reason:ok?def.reason:`Required governed source entry ${def.match} is missing or not approved.`,source:src?{name:src.name,url:src.url,license:src.license,status:src.status}:null};
  });
}
