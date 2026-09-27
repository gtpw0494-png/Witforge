function host(url){try{return new URL(url).hostname.toLowerCase()}catch{return""}}
function matches(hostname,domain){domain=String(domain||"").toLowerCase();return hostname===domain||hostname.endsWith("."+domain)}

export class KnowledgeResearchWorker {
  constructor({webResearch,webCorpus,sources=[],audit=null}={}) {
    this.webResearch=webResearch;this.webCorpus=webCorpus;this.sources=(sources||[]).filter(x=>x.allowed);this.audit=audit;
  }
  async researchTopic(topic,{perSource=2,maxSources=12}={}) {
    const q=String(topic||"").trim();
    if(!q)return{state:"BLOCKED",message:"A research topic is required.",topic:q};
    const evidence=[];const errors=[];let searched=0;
    for(const source of this.sources){
      if(evidence.length>=maxSources)break;
      const search=await this.webResearch.search(`site:${source.domain} ${q}`,{limit:Math.max(3,perSource*2)});
      searched++;
      const approved=(search.results||[]).filter(x=>matches(host(x.url),source.domain)).slice(0,perSource);
      for(const item of approved){
        if(evidence.length>=maxSources)break;
        const ingest=await this.webCorpus.ingestUrl({
          url:item.url,
          license:String(source.license||"UNKNOWN").toUpperCase(),
          licenseSource:`knowledge_sources:${source.id}`,
          respectRobots:true,
          maxBytes:1_500_000,
          promoteTraining:false
        });
        evidence.push({source_id:source.id,domain:source.domain,url:item.url,title:item.title||null,state:ingest.state,document_id:ingest.document?.document?.id||null,content_sha256:ingest.contentSha256||null,training_eligible:false,quarantine_state:ingest.quarantineState||null});
      }
      if(search.state!=="SUCCESS")errors.push({source_id:source.id,state:search.state,errors:search.errors||[]});
    }
    const stored=evidence.filter(x=>["SUCCESS","PARTIAL"].includes(x.state)).length;
    const out={state:stored?"SUCCESS":evidence.length?"PARTIAL":"UNAVAILABLE",topic:q,searched_source_classes:searched,evidence_count:evidence.length,stored,evidence,errors,training_eligible:0,truth:"Research storage never grants training eligibility; independent verification and promotion remain separate."};
    this.audit?.append?.({type:"knowledge.research.completed",topic:q,state:out.state,stored,evidence:evidence.length});
    return out;
  }
}
export default KnowledgeResearchWorker;
