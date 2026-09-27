# UAI Operations

## Supported operating mode

UAI is local-first and runs on localhost. Termux remains a supported deployment target.

## Fresh clone

```bash
git clone https://github.com/gtpw0494-png/UAI.git
cd UAI
npm ci --omit=optional
npm test
npm run test:security
npm run test:control-plane
python3 verification/test_data_learning.py
python3 model/tokenizer.py status
npm start
```

## Runtime status

```bash
curl -s http://127.0.0.1:8787/api/status | python3 -m json.tool
curl -s http://127.0.0.1:8787/api/audit/verify | python3 -m json.tool
```

## Local state

Mutable runtime state belongs under ignored local paths such as:
- `state/`
- `data/*.sqlite3`
- `model/checkpoints/`
- `model/runs/`
- `model/tokenizers/`
- `vendor-data/`
- `vendor-reference/`

Do not commit credentials or user data.

## Database behavior

Governance data uses SQLite WAL with optimistic versions. Node uses native `node:sqlite` where available and falls back to the Python SQLite helper otherwise.

v0.43 migrates legacy JSON state for:
- agents;
- accounts;
- subscriptions;
- control-center plugins;
- availability snapshots.

Legacy files are renamed with `.migrated-v043` after successful import.

## Release discipline

All work starts from verified `main` on a `build/*` branch. CI and manifest refresh apply generically to build branches. Main advances only after exact-commit evidence and authoritative CI succeed.
