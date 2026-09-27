#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -z "${UAI_OWNER_EMAIL:-}" ]; then
  printf "Owner email: "
  IFS= read -r UAI_OWNER_EMAIL
  export UAI_OWNER_EMAIL
fi

if [ -z "${UAI_OWNER_PASSWORD:-}" ]; then
  printf "Owner password: "
  IFS= read -r -s UAI_OWNER_PASSWORD
  printf "\n"
  export UAI_OWNER_PASSWORD
fi

if [ "${1:-}" = "--configure" ]; then
  node scripts/configure-owner.mjs --replace
  unset UAI_OWNER_PASSWORD
  exit 0
fi

exec node server.js
