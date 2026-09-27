#!/data/data/com.termux/files/usr/bin/bash
set -e
pkg update -y
pkg install -y nodejs python git
printf '\n== Node tests ==\n'
npm test
if [ "${ENABLE_AI_STACK:-0}" = "1" ]; then
  printf '\n== Enabling neural + LangGraph stack ==\n'
  ./scripts/enable-termux-capabilities.sh
else
  printf '\nTip: run ENABLE_AI_STACK=1 ./run-termux.sh or ./scripts/enable-termux-capabilities.sh to enable Termux PyTorch + LangGraph.\n'
fi
printf '\n== Capability probe ==\n'
node scripts/probe-capabilities.js || true
printf '\nStarting IntraultUniversalion at http://127.0.0.1:8787\n'
npm start
