const words=x=>new Set(String(x||"").toLowerCase().match(/[a-z0-9_'-]+/g)||[]);
export function detectDisagreement(outputs=[]){
  const rows=outputs.filter(Boolean).map(x=>typeof x==="string"?x:(x.text||x.message||JSON.stringify(x)));
  if(rows.length<2)return {state:"SUCCESS",disagreement:0,needsExpansion:false,pairs:[]};
  const pairs=[];let total=0;
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
    const a=words(rows[i]),b=words(rows[j]),u=new Set([...a,...b]),inter=[...a].filter(x=>b.has(x)).length;
    const disagreement=u.size?1-inter/u.size:0;total+=disagreement;pairs.push({a:i,b:j,disagreement:Number(disagreement.toFixed(4))});
  }
  const score=total/pairs.length;return {state:"SUCCESS",disagreement:Number(score.toFixed(4)),needsExpansion:score>=0.55,pairs};
}
