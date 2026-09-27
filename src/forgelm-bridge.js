import {spawn} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function run(script,args,timeout=120000,{signal=null,onEvent=null}={}){
  return new Promise(resolve=>{
    const p=spawn(process.env.PYTHON||"python3",[path.join(root,"model",script),...args],{cwd:path.join(root,"model")});
    let out="",err="",settled=false,lineBuffer="",timer=null;
    const finish=payload=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);resolve(payload)};
    p.stdout.on("data",x=>{
      const chunk=String(x);out+=chunk;lineBuffer+=chunk;
      let i;
      while((i=lineBuffer.indexOf("\n"))>=0){
        const line=lineBuffer.slice(0,i).trim();lineBuffer=lineBuffer.slice(i+1);
        if(!line)continue;
        try{const event=JSON.parse(line);if(event?.type==="token")onEvent?.(event);}catch{}
      }
    });
    p.stderr.on("data",x=>{err+=x;onEvent?.({type:"stderr",chunk:String(x)});});
    p.on("error",e=>finish({state:"UNAVAILABLE",message:String(e.message||e),script}));
    p.on("close",code=>{
      if(settled)return;
      let parsed=null;
      for(const line of String(out).trim().split(/\r?\n/).reverse()){try{parsed=JSON.parse(line);break}catch{}}
      finish(parsed&&typeof parsed==="object"?{...parsed,exitCode:code,script}:{state:code===0?"SUCCESS":"FAILURE",message:err||out||`exit ${code}`,exitCode:code,script});
    });
    const abort=()=>{try{p.kill("SIGTERM")}catch{};finish({state:"CANCELLED",message:`${script} cancelled`,script})};
    if(signal){if(signal.aborted)return abort();signal.addEventListener("abort",abort,{once:true});}
    timer=setTimeout(()=>{p.kill("SIGTERM");finish({state:"TIMEOUT",message:`${script} timed out`,script})},timeout);
  });
}

export class ForgeLMBridge{
  status(){return run("self_sufficient.py",["status"],15000)}
  train(steps=80,{preset="termux-tiny",gradAccum=1}={}){return run("cli.py",["train","--steps",String(steps),"--preset",String(preset),"--grad-accum",String(gradAccum)],300000)}
  chat(prompt,max=64,opts={}){const args=["chat","--prompt",String(prompt),"--max-tokens",String(max)];if(opts?.onEvent)args.push("--stream");return run("self_sufficient.py",args,120000,opts)}
  capability(task,prompt="",context="",max=128){return run("self_sufficient.py",[String(task),"--prompt",String(prompt),"--context",String(context),"--max-tokens",String(max)])}
  embeddings(input){return this.capability("embeddings",JSON.stringify(Array.isArray(input)?input:[String(input)]),"",1)}
  rerank(query,documents=[]){return this.capability("rerank",String(query),JSON.stringify(documents),1)}
  longContext(query,sourceText,max=192){return this.capability("long-context",String(query),String(sourceText),max)}
  visionStatus(){return run("vision_runtime.py",["status"],30000)}
  visionDescribe(image,prompt="Describe the image using only what the visual evidence supports.",max=96){return run("vision_runtime.py",["describe","--image",String(image),"--prompt",String(prompt),"--max-tokens",String(max)],120000)}
  audioStatus(){return run("audio_runtime.py",["status"],30000)}
  audioDescribe(audio,prompt="Describe or transcribe the audio using only the acoustic evidence.",max=96){return run("audio_runtime.py",["describe","--audio",String(audio),"--prompt",String(prompt),"--max-tokens",String(max)],120000)}
  speechStatus(){return run("speech_runtime.py",["status"],30000)}
  speechSynthesize(text,output){return run("speech_runtime.py",["synthesize","--text",String(text),"--output",String(output)],120000)}
  videoStatus(){return run("video_runtime.py",["status"],30000)}
  videoDescribe(video,prompt="Describe the video using only the temporal and visual evidence.",max=96){return run("video_runtime.py",["describe","--video",String(video),"--prompt",String(prompt),"--max-tokens",String(max)],180000)}
  multimodalStatus(){return run("multimodal_runtime.py",["status"],30000)}
  multimodalChat({prompt="",context="",document="",image=null,audio=null,video=null,max=128,signal=null,onEvent=null}={}){const args=["chat","--prompt",String(prompt),"--context",String(context),"--document",String(document),"--max-tokens",String(max)];if(image)args.push("--image",String(image));if(audio)args.push("--audio",String(audio));if(video)args.push("--video",String(video));if(onEvent)args.push("--stream");return run("multimodal_runtime.py",args,240000,{signal,onEvent})}
  selfSufficientStatus(){return run("self_sufficient.py",["status"],15000)}
}
