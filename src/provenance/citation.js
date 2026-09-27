export class CitationVerifier{
  constructor(graph){this.graph=graph;}
  verifyEnvelope(envelope={}){
    const supports=(envelope.claims||[]).flatMap(c=>c.support||[]),checks=supports.map(s=>{const candidates=[s.source_id,s.document_id,s.chunk_id].filter(Boolean);let matched=null;for(const id of candidates){matched=this.graph.listNodes({limit:10000}).find(n=>n.subjectId===id||n.sourceId===id||n.id===id);if(matched)break;}return {support:s,matchedNodeId:matched?.id||null,verified:Boolean(matched)};});
    const verified=checks.filter(x=>x.verified).length;return {state:checks.length&&verified===checks.length?"SUCCESS":verified?"PARTIAL":"UNAVAILABLE",citations:checks.length,verified,unverified:checks.length-verified,checks};
  }
}
