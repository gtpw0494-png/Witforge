#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/vendor-data"
mkdir -p "$DATA/wordnet" "$DATA/oasst1"
WORDNET_URL="https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz"
OASST_URL="https://huggingface.co/datasets/OpenAssistant/oasst1/resolve/main/2023-04-12_oasst_ready.messages.jsonl.gz?download=true"
command -v curl >/dev/null || { echo 'curl is required (pkg install curl)'; exit 1; }
if [ ! -f "$DATA/wordnet/WordNet-3.0.tar.gz" ]; then curl -fL --retry 3 "$WORDNET_URL" -o "$DATA/wordnet/WordNet-3.0.tar.gz"; fi
if [ ! -d "$DATA/wordnet/WordNet-3.0" ]; then tar -xzf "$DATA/wordnet/WordNet-3.0.tar.gz" -C "$DATA/wordnet"; fi
if [ ! -f "$DATA/oasst1/2023-04-12_oasst_ready.messages.jsonl.gz" ]; then curl -fL --retry 3 "$OASST_URL" -o "$DATA/oasst1/2023-04-12_oasst_ready.messages.jsonl.gz"; fi
python3 "$ROOT/storage/db.py" init
python3 "$ROOT/research/import_wordnet.py" --input "$DATA/wordnet/WordNet-3.0"
python3 "$ROOT/research/import_oasst1.py" --input "$DATA/oasst1/2023-04-12_oasst_ready.messages.jsonl.gz" --language en
python3 "$ROOT/storage/export_training.py"
echo 'Language data ready. Use OneChat: define resilience | banter about music | storage database status'
