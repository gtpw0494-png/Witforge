export function evaluateDeletion({kind,sourceId=null,hard=false,trainingEligible=false,provenanceLinked=false}={}){
  const actions=["remove-retrieval-index"];
  if(hard)actions.push("delete-primary-record");
  if(sourceId&&provenanceLinked)actions.push("purge-derived-provenance");
  if(trainingEligible)actions.push("invalidate-future-training-export");
  return {state:"SUCCESS",allowed:true,kind:String(kind||"data"),sourceId,hard:Boolean(hard),requiredActions:actions,principle:"Deletion must propagate through eligible indexes and derived artifacts without deleting audit evidence of the deletion event."};
}
