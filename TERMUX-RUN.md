# Termux run — v0.49.0

## Owner email/password login

UAI v0.49 uses email/password owner login with server-side sessions and CSRF. Legacy owner bearer tokens are not accepted.

First local bootstrap:

```bash
cd ~/UAI
export UAI_OWNER_EMAIL="gtpw0494@gmail.com"
read -rsp 'Owner password: ' UAI_OWNER_PASSWORD; echo
export UAI_OWNER_PASSWORD
chmod +x scripts/run-owner-local.sh
./scripts/run-owner-local.sh
```

Existing installation credential rotation:

```bash
cd ~/UAI
export UAI_OWNER_EMAIL="gtpw0494@gmail.com"
read -rsp 'Owner password: ' UAI_OWNER_PASSWORD; echo
export UAI_OWNER_PASSWORD
node scripts/configure-owner.mjs --replace
unset UAI_OWNER_PASSWORD
npm start
```

The password is not committed to Git, stored in browser storage, or returned by the API. The governance database stores a salted scrypt verifier. Credential rotation revokes active owner sessions.

From the GitHub working copy:

```bash
cd ~/UAI
git pull origin main
pkg install -y python sqlite nodejs git curl
npm test
npm start
```

OneChat task lifecycle examples:

```text
plan task: research local model architecture
run task: research local model architecture
show tasks
task status task-<id>
resume task task-<id>
cancel task task-<id>
availability report
```

Language/storage operations remain:

```bash
npm run storage:init
npm run language:fetch
npm run language:export
npm run semantic:build
python3 storage/db.py related --term intelligence --relation hypernym
python3 storage/semantic.py search --query "machine intelligence" --kind all --limit 8
```

Tokenizer tooling remains Torch-independent:

```bash
python3 model/tokenizer.py status
python3 model/tokenizer.py train --corpus model/data/training-corpus.txt --vocab-size 1024 --engine auto
```

ForgeLM neural training still requires a compatible PyTorch runtime.

## v0.42 verification commands

```bash
cd ~/intraultuniversalion-v0.6.0/intraultuniversalion-v0.6.0
npm test
npm run test:security
python3 model/adaptation.py status
python3 storage/lifecycle.py status
python3 model/continual.py snapshot --limit 500
npm start
```

Useful OneChat checks:

```text
model registry
llama runtime status
observability metrics
data lifecycle
availability report
show approvals
show autonomy
```

To bulk-import web material for retrieval only, omit `--training-approved`. Add that flag only after source/license/security review when the records are genuinely approved for training.


## v0.52 bounded R&D commands

Run these from the UAI repository root:

```bash
cd ~/UAI
git pull --ff-only origin main
npm install --ignore-scripts --omit=optional

npm run shadow:status
npm run shadow:agents
npm run shadow:runs

npm run light:status
npm run light:agents
npm run light:patches

npm run test:shadow-light
npm run test:shadow-light-http
npm test
```

Create bounded proposals from the CLI:

```bash
node scripts/shadow-cli.js submit research-discovery "compare approved retrieval evidence and identify gaps"
node scripts/light-cli.js propose test-repair "reproduce and repair the failing deterministic test"
```

The shadow CLI creates quarantined research runs/candidates only. The light CLI creates source-maintenance proposals only; it does not merge protected `main`. Promotion remains a separate owner-authorized path.

## v0.53 persistent agent control plane

The v0.53 control plane uses dedicated SQLite tables for shadow runs/candidates, light patches/worktrees, and scheduler jobs. Workers are bounded and lease-based; expired leases are recovered rather than spawning unbounded descendants.

```bash
cd ~/UAI
git checkout main
git pull --ff-only origin main
npm install --ignore-scripts --omit=optional

node -p "'UAI version: ' + require('./package.json').version"

npm run control:status
npm run control:jobs
npm run control:jobs -- 100 shadow
npm run control:jobs -- 100 light

npm run test:agent-control
npm run test:agent-control-http
```

Run one queued unit of work explicitly:

```bash
npm run control:dispatch -- shadow termux-shadow-1
npm run control:dispatch -- light termux-light-1
```

Run expiry/lease recovery maintenance:

```bash
npm run control:maintenance
```

The local CLI never grants promotion authority. Shadow output remains quarantined/promotion-gated, and light work remains isolated from protected `main`. The authenticated HTTP control plane additionally enforces session/CSRF policy and the governance emergency stop.

## v0.54 user-owned intelligence plane

Pull and verify:

```bash
cd ~/UAI
git checkout main
git pull --ff-only origin main
npm install --ignore-scripts --omit=optional

node -p "'UAI version: ' + require('./package.json').version"
npm run test:platform-intelligence
npm run test:platform-intelligence-http
npm run platform:status
```

Optional encrypted local memory: provide a 32-byte key as 64 hex characters or base64 before starting UAI. Keep the key outside Git.

```bash
export IUV_MEMORY_KEY="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)"
npm start
```

Useful local commands:

```bash
npm run memory:status -- owner-local
npm run provenance:status
npm run evaluations:status

node scripts/platform-intelligence-cli.js remember owner-local "Prefer evidence-first local execution"
node scripts/platform-intelligence-cli.js memory-list owner-local
node scripts/platform-intelligence-cli.js memory-search owner-local evidence-first
node scripts/platform-intelligence-cli.js policy-simulate "high risk source code change with external API"
```

OneChat commands after owner login:

```text
remember that I prefer local-first execution
show memory
why remembered memory-<id>
forget memory-<id>
forget source <source-id>
disable memory
disable training
export memory
provenance graph status
trace provenance prov-node-<id>
simulate policy high risk source modification using an external API
```

Memory is not silently created from ordinary conversation and is not training-eligible by default. Provenance purge planning is a dry run unless an explicitly authorized purge route is used. Artifact integrity verification does not imply the model runtime is connected or production-approved.

