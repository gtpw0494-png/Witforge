#!/data/data/com.termux/files/usr/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; DEST="$ROOT/vendor-reference"; mkdir -p "$DEST"
command -v git >/dev/null || { echo "git is required"; exit 1; }
clone(){ name="$1"; url="$2"; if [ -d "$DEST/$name/.git" ]; then echo "$name already present"; else git clone --depth 1 "$url" "$DEST/$name"; fi; }
clone openai-gpt-oss https://github.com/openai/gpt-oss.git
clone xai-grok-1 https://github.com/xai-org/grok-1.git
clone deepseek-v3 https://github.com/deepseek-ai/DeepSeek-V3.git
clone google-deepmind-gemma https://github.com/google-deepmind/gemma.git
clone huggingface-transformers https://github.com/huggingface/transformers.git
clone sarus-arena https://github.com/arena-ai/arena.git
echo "Reference repositories fetched. They remain separate vendor-reference material; ForgeLM source stays original. Review each license/model license before redistributing weights or source." 
