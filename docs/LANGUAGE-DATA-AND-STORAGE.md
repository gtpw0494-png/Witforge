# Language Data and Storage — v0.26.0

## Selected sources

### Princeton WordNet 3.0
Used for local definitions. The project downloader obtains the official WordNet 3.0 archive from Princeton. The importer records term, part of speech, synset, gloss/definition, example text, source, license and a deterministic record hash.

### OpenAssistant OASST1
Used as the default freely licensed dialogue/banter-style corpus. The default importer reads the `oasst_ready` message export, filters to English unless another language is requested, keeps message-tree relationships and stores each accepted message with provenance.

DailyDialog is deliberately not the default banter source because the published dataset license is CC BY-NC-SA 4.0.

## Storage architecture

The existing IUB knowledge store remains intact for governed project records and audit/provenance workflows. v0.26.0 adds `data/intraultuniversalion.sqlite3` for high-volume searchable language material.

SQLite tables:
- `sources`
- `definitions`
- `dialogue_messages`
- `knowledge_records`
- `ingest_runs`

Where SQLite FTS5 is available, `definitions_fts` and `dialogue_fts` provide full-text search. The implementation falls back to indexed/LIKE lookup when FTS5 is unavailable.

## OneChat commands

- `storage database status`
- `define resilience`
- `definition of recursion`
- `banter about music`
- `conversation about programming`

## Fetch and import

```bash
pkg install -y curl tar gzip python sqlite
npm run language:fetch
```

The script downloads the two selected sources into `vendor-data/`, imports them into SQLite and exports a bounded language dataset for ForgeLM.

## ForgeLM bridge

`storage/export_training.py` exports training-eligible records only:
- WordNet definitions become `Define TERM` instruction/response examples.
- OASST1 assistant replies are paired with their parent prompt.

The export preserves source name, source ID and license in each training record. `model/data_pipeline.py` includes this export in dataset-v2 alongside verified traces and governed web records.
