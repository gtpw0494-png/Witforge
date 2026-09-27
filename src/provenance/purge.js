export class ProvenancePurge{
  constructor(graph){this.graph=graph;}
  plan(sourceNodeId){return this.graph.planPurge(sourceNodeId);}
  apply(sourceNodeId,options={}){return this.graph.purge(sourceNodeId,{...options,apply:true});}
}
