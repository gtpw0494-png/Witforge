export class MemoryRetrieval{
  constructor(memoryStore){this.memory=memoryStore;}
  search(query,options={}){return this.memory.search(query,options);}
  recent(ownerId,namespace=null,limit=20){return {state:"SUCCESS",results:this.memory.list({ownerId,namespace,limit})};}
}
