#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export HOST="0.0.0.0"
export PORT="${PORT:-8787}"
export IUV_STATE_DIR="${IUV_STATE_DIR:-$PWD/state}"

if [[ -n "${CODESPACE_NAME:-}" && -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
  export IUV_ALLOWED_ORIGINS="https://${CODESPACE_NAME}-${PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}${IUV_ALLOWED_ORIGINS:+,${IUV_ALLOWED_ORIGINS}}"
fi

mkdir -p "$IUV_STATE_DIR"

echo "UAI Codespaces host: $HOST"
echo "UAI port: $PORT"
if [[ -n "${CODESPACE_NAME:-}" && -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
  echo "Forwarded URL: https://${CODESPACE_NAME}-${PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
fi

exec node server.js
