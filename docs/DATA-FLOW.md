# UAI Data Flow

## Ingestion

```text
source
 -> fetch/import
 -> quarantine
 -> parse/normalize
 -> security signals
 -> provenance/license classification
 -> deduplication
 -> retrieval eligibility
 -> optional explicit training approval
 -> durable storage/index
```

Retrieval eligibility never implies training eligibility.

## Node/Python transfer contract

Cross-runtime messages use versioned integrity envelopes from `src/contracts.js` and `schemas/event-envelope.schema.json`.

Required properties include:
- schema version
- event type
- producer/consumer
- correlation ID
- provenance
- security labels
- retention policy
- payload
- SHA-256 integrity hash

## Retrieval

```text
query
 -> lexical FTS
 -> sparse semantic retrieval
 -> metadata/lifecycle filter
 -> ranking
 -> context assembly
 -> response
 -> evidence/citation layer
```

Current retrieval is FTS5 plus dependency-free sparse hashed vectors. Dense embeddings and neural reranking remain future/runtime-conditional additions.

## Training promotion

Training data is built only from approved sources:
- verified successful traces;
- explicitly eligible language records;
- web records with both `trainingEligible=true` and `trainingApproved=true`.

Raw conversations are not silently promoted.

## Deletion

Source lifecycle supports:
- retention metadata;
- soft deletion, which excludes records from retrieval;
- hard purge of source-backed language data.

Future document/chunk stores must preserve the same deletion semantics across indexes, datasets and derived artifacts.

## v0.45 provenance document plane

The ordinary retrieval path now has a revisioned document layer in addition to the legacy language/web stores:

```text
source
 -> canonical URI
 -> normalized content hash
 -> content-addressed object
 -> document revision
 -> deterministic chunks
 -> retrieval eligibility
 -> FTS index
 -> citation-bearing OneChat evidence
```

Each stored document records source ID, canonical/original URI, revision, content hash, parser and normalization versions, publisher, language, retrieval time, security metadata, provenance metadata, retrieval eligibility, training approval and deletion state.

Direct web ingestion continues writing the legacy governed web record for compatibility, and also attempts to persist the same normalized text into the provenance document plane. If that second persistence step fails, web ingestion reports `PARTIAL` rather than hiding the failure.

### Current state model

```text
RAW
QUARANTINED
PARSED
NORMALIZED
REVIEW_REQUIRED
RETRIEVAL_ELIGIBLE
TRAINING_ELIGIBLE
REJECTED
DELETED
```

A document may be retrievable without being training-eligible. Training eligibility requires source eligibility plus explicit training approval.

### Deletion

Soft deletion removes chunks from retrieval and marks document/chunk state `DELETED`. Hard purge removes the document and removes its content-addressed object only when no remaining document revision references that content hash.

### Truth boundary

v0.45 is text-document lineage. Dense embeddings/reranking, page/frame/timestamp/bounding-box lineage, graph-wide derived-artifact purge and multimodal parsers remain separate future capabilities.

## v0.49 answer evidence

OneChat answers now create an integrity-hashed `uai.evidence.v1` envelope:

```text
answer
 -> claim support state
 -> cited source/document/chunk excerpts when retrieved
 -> selected model/provider route
 -> bounded tool/agent result summary
 -> SHA-256 integrity digest
```

Supported claim states are `SUPPORTED`, `PARTIALLY_SUPPORTED`, `CONFLICTING`, `STALE`, `INFERENCE`, `OPINION`, and `UNSUPPORTED`.

`explain answer` returns this structured evidence for the previous answer in the same chat. It does not expose private model chain-of-thought.

Conversation turns and evidence records are persisted through the existing knowledge store, but full model-context rehydration after process restart remains PARTIAL.

