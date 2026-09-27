# GitHub operating model

`gtpw0494-png/UAI` is the source repository for the project.

## Branching
- `main`: known-good cumulative checkpoint only.
- build branches: additive development and validation before merge.

## Public-repository privacy boundary
Do not commit local mutable or user-derived runtime data. The ignore policy excludes:
- local IUB knowledge records and indexes
- SQLite databases
- state/audit/task/action-envelope/account/subscription files
- ForgeLM checkpoints, runs and generated datasets
- generated tokenizer artifacts
- `.env` files and vendor data/reference trees

Only source, schemas, fixtures, documentation and explicitly safe seed material belong in the public source tree.

## Validation before main
1. `npm test`
2. `python3 model/tokenizer.py status`
3. initialize an isolated SQLite DB and run semantic-index smoke checks
4. build and verify the release manifest
5. localhost `/api/status` and `/api/onechat` smoke test

The repository must not claim runtime availability based only on source presence.
