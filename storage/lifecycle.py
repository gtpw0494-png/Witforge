#!/usr/bin/env python3
from __future__ import annotations
import argparse,json,sys
from datetime import datetime,timezone,timedelta
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from storage.db import connect,init_schema,now

def emit(x): print(json.dumps(x,ensure_ascii=False))
def main():
 ap=argparse.ArgumentParser();sp=ap.add_subparsers(dest='cmd',required=True)
 sp.add_parser('status')
 r=sp.add_parser('retain');r.add_argument('--source-id',required=True);r.add_argument('--days',type=int,required=True)
 d=sp.add_parser('delete-source');d.add_argument('--source-id',required=True);d.add_argument('--reason',default='user-requested deletion')
 p=sp.add_parser('purge-source');p.add_argument('--source-id',required=True);p.add_argument('--reason',default='user-requested purge')
 a=ap.parse_args();c,path=connect();init_schema(c)
 try:
  if a.cmd=='status':
   rows=[dict(x) for x in c.execute('SELECT l.*,s.name FROM source_lifecycle l LEFT JOIN sources s ON s.id=l.source_id ORDER BY l.updated_at DESC')]
   emit({'state':'SUCCESS','database':str(path),'sourceLifecycle':rows});return
  if a.cmd=='retain':
   until=(datetime.now(timezone.utc)+timedelta(days=max(0,a.days))).isoformat();c.execute('INSERT INTO source_lifecycle(source_id,retention_until,deleted_at,deletion_reason,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET retention_until=excluded.retention_until,updated_at=excluded.updated_at',(a.source_id,until,None,None,now()));c.commit();emit({'state':'SUCCESS','sourceId':a.source_id,'retentionUntil':until});return
  ts=now();c.execute('BEGIN IMMEDIATE');c.execute('INSERT INTO source_lifecycle(source_id,retention_until,deleted_at,deletion_reason,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET deleted_at=excluded.deleted_at,deletion_reason=excluded.deletion_reason,updated_at=excluded.updated_at',(a.source_id,None,ts,a.reason,ts))
  purged={'definitions':0,'relations':0,'dialogue':0}
  if a.cmd=='purge-source':
   purged['relations']=c.execute('DELETE FROM lexical_relations WHERE source_id=?',(a.source_id,)).rowcount
   purged['definitions']=c.execute('DELETE FROM definitions WHERE source_id=?',(a.source_id,)).rowcount
   purged['dialogue']=c.execute('DELETE FROM dialogue_messages WHERE source_id=?',(a.source_id,)).rowcount
  c.execute('COMMIT');emit({'state':'SUCCESS','sourceId':a.source_id,'deletedAt':ts,'purged':purged,'mode':'HARD_PURGE' if a.cmd=='purge-source' else 'SOFT_DELETE'})
 finally:c.close()
if __name__=='__main__':main()
