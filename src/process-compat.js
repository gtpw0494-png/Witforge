import path from "node:path";

export function isTermuxRuntime(env=process.env){
  const preload=String(env.LD_PRELOAD||"");
  return process.platform==="android" || Boolean(env.TERMUX_VERSION) || preload.includes("libtermux-exec");
}

export function termuxSafeEnv(extra={}){
  const env={...process.env,...extra};
  const preload=String(env.LD_PRELOAD||"");
  if(isTermuxRuntime(env) && preload.includes("libtermux-exec")){
    delete env.LD_PRELOAD;
  }
  return env;
}

/*
 * Node child processes on Termux must retain libtermux-exec when the parent
 * runtime supplied it. Removing the preload breaks executable/shebang
 * translation on current Termux builds and can produce errors such as
 * "expected absolute path" or "env: node: Permission denied".
 */
export function nodeChildEnv(extra={}){
  return {...process.env,...extra};
}

export function absoluteNodeScript(root,script){
  return path.resolve(root,script);
}

export function nodeScriptInvocation(root,script,args=[]){
  return {
    command:process.execPath,
    args:[absoluteNodeScript(root,script),...args.map(String)]
  };
}
