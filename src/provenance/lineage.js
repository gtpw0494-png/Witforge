export const PROVENANCE_RELATIONS=Object.freeze(["FETCHED_AS","NORMALIZED_TO","CHUNKED_TO","EMBEDDED_AS","RETRIEVED_IN","SUPPORTED","PRODUCED","DERIVED_FROM","TRAINING_EXAMPLE","TRAINED_ADAPTER","DEPLOYED_AS","USED_BY","HANDLED_BY"]);
export function lineageRelation(value){const x=String(value||"").trim().toUpperCase();return PROVENANCE_RELATIONS.includes(x)?x:null;}
