#!/data/data/com.termux/files/usr/bin/bash
set -e
PROFILE="${1:-termux-lite}"; ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
case "$PROFILE" in
 termux-lite)
  echo "Termux-lite keeps the Node app fully functional. Python ForgeLM is enabled only if a compatible torch build is already installed."
  pkg install -y python git clang cmake rust || true
  python -m pip install --upgrade numpy 2>/dev/null || true
  python model/dependency_status.py
  ;;
 desktop-train)
  python -m venv .venv; . .venv/bin/activate; python -m pip install -U pip
  pip install -r requirements/core.txt -r requirements/training.txt -r requirements/orchestration.txt
  python model/dependency_status.py
  ;;
 research)
  python -m venv .venv; . .venv/bin/activate; python -m pip install -U pip
  pip install -r requirements/core.txt -r requirements/training.txt -r requirements/orchestration.txt -r requirements/research-backends.txt
  python model/dependency_status.py
  ;;
 *) echo "profiles: termux-lite | desktop-train | research"; exit 2;;
esac
