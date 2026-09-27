# Durable task and action lifecycle — v0.31–v0.34

## Purpose
IntraultUniversalion now persists orchestration state instead of treating every task run as an in-memory event.

## Task state model
`NEW → PLANNING → AUTHORIZED → EXECUTING → VERIFYING → COMPLETED|FAILED`

Explicit continuation and recovery can additionally use:
`RECOVERING → CONTINUING → EXECUTING`

Explicit cancellation produces `CANCELLED`.

The broader vocabulary also reserves `WAITING_APPROVAL` and `CORRECTING` for future flows. High-impact adapters keep their own approval gates; the task engine does not bypass them.

## Action envelope
Each durable task receives an action envelope containing:
- subject and agent identity
- intent and plan
- capability scope
- authority basis
- independent security decision metadata
- approval binding slot
- execution state and step evidence
- verification state/evidence
- recovery state
- audit lineage
- immutable creation time plus transition history

Task persistence lives in local mutable state and is intentionally not committed to GitHub.

## OneChat commands
- `plan task: <request>`
- `run task: <request>`
- `show tasks`
- `task status <task-id>`
- `resume task <task-id>`
- `cancel task <task-id>`
- `availability report`

## HTTP API
- `GET /api/tasks`
- `GET /api/tasks/status?id=...`
- `POST /api/tasks/plan`
- `POST /api/tasks/run`
- `POST /api/tasks/resume`
- `POST /api/tasks/cancel`
- `GET /api/actions`
- `GET /api/availability`

## Truth boundary
A persisted plan is not execution. A task step records the state returned by the component that actually handled it. Failed steps remain failed until explicitly resumed and successfully re-executed. Availability evidence distinguishes runtime-connected, configuration-only, registered-source and unavailable states.
