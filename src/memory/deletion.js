export class MemoryDeletionService{
  constructor(memoryStore){this.memory=memoryStore;}
  forget(id,ownerId,reason){return this.memory.forget(id,ownerId,reason);}
  forgetSource(sourceId,ownerId,reason){return this.memory.forgetSource(sourceId,ownerId,reason);}
  purge(id,ownerId,reason){return this.memory.purge(id,ownerId,reason);}
}
