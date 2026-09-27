#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "== IntraultUniversalion capability bootstrap =="
if ! command -v pkg >/dev/null 2>&1; then echo "This script is intended for Termux (pkg command not found)."; exit 2; fi
pkg update -y
pkg install -y python python-numpy python-torch nodejs git
python3 - <<'PY'
import json
try:
 import torch
 print(json.dumps({"torch":"CONNECTED","version":torch.__version__}))
except Exception as e:
 print(json.dumps({"torch":"UNAVAILABLE","error":str(e)})); raise
PY
# LangGraph is optional to the base application but a core capability in v0.25.
npm install --no-audit --no-fund @langchain/langgraph@1.4.17 @langchain/core@1.2.12 zod@4.6.5
node -e 'import("@langchain/langgraph").then(()=>console.log("LangGraph.js CONNECTED")).catch(e=>{console.error(e);process.exit(1)})'
python3 model/cli.py status
node scripts/probe-capabilities.js
cat <<'EOF'

Local capability bootstrap completed.
ForgeLM train/infer/trainer should become CONNECTED if python-torch imported and the checkpoint is intact.
LangGraph should become CONNECTED if the package import above succeeded.
Stripe/Oxford/OctoPrint remain truthfully CONFIGURED/UNAVAILABLE until their credentials/hardware are supplied.
EOF
