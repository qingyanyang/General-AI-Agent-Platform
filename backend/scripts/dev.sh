#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -d .venv ]]; then
  echo "Missing .venv. Create it with: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements-dev.txt" >&2
  exit 1
fi

# shellcheck disable=SC1091
source .venv/bin/activate

exec uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
