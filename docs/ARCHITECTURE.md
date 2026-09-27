# UAI Architecture

UAI is a local-first, evidence-governed AI operating platform. The architectural invariant is that model intelligence may propose, plan and reason, but execution authority remains outside the model.

## Planes

### Control plane
Owns identity-adjacent runtime state, policy, approvals, autonomy leases, capability truth, plugin registry, model registry and durable orchestration state.

Current implementation:
- `GovernanceDb` — SQLite WAL record/event store with optimistic CAS.
- `TaskStore` — legal task state transitions and durable checkpoints.
- `ActionEnvelopeStore` — action identity, intent, scope, execution, verification and recovery.
- `ApprovalStore` — exact-operation approval binding.
- `AutonomyStore` — bounded, expiring, revocable leases.
- `AgentRegistry`, `ControlCenter`, `AvailabilityLedger` — migrated to governance SQLite in v0.43.

### Execution plane
Owns actions that can change state or call runtimes:
- task execution
- model inference/training
- plugin sandbox execution
- web ingestion
- source-development sandbox
- optional external adapters

Execution paths must not self-authorize.

### Evidence plane
Owns facts about what happened:
- tamper-evident audit chain
- task/action histories
- verification states
- release manifest
- feature evidence registry
- retrieval/evaluation results

A model or plugin may emit evidence inputs but cannot decide that its own result is verified.

### Data plane
Owns durable user/project data:
- language/knowledge SQLite
- FTS and sparse semantic index
- datasets and training exports
- content-addressed or hash-recorded artifacts
- local checkpoints/runtime state excluded from public Git

## Current request path

```text
OneChat / HTTP / CLI
  -> intent routing
  -> task/action planning
  -> policy evaluation
  -> approval or autonomy check where applicable
  -> execution adapter
  -> verification/evidence
  -> durable state/audit
  -> response
```

## Target decomposition

The blueprint target is a modular split into:
- `api/`
- `application/`
- `domain/`
- `orchestration/`
- `policy/`
- `plugins/`
- `retrieval/`
- `storage/`
- `observability/`

The current flat `src/` layout remains valid while modules are migrated incrementally. Refactors must preserve behavior and evidence before old paths are removed.

## Non-bypass rule

No model or plugin may:
- directly grant itself approval;
- create or widen autonomy scope;
- rewrite capability truth;
- write a VERIFIED feature-evidence claim without executable repository evidence;
- directly alter audit integrity metadata;
- turn retrieval eligibility into training permission;
- present registry presence as runtime connectivity.

## Promotion rule

A source feature is not production-verified because code exists. Promotion requires:
1. implementation path;
2. executable tests;
3. authoritative CI on the exact candidate commit;
4. truthful feature-evidence status;
5. no privacy-boundary regression.
