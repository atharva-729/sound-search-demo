#!/bin/bash
# Sound Search on a Mac: full version with typed search.
# First run installs uv, Python and the packages (about 1 GB, 5-10 minutes, needs internet once).
# If macOS blocks it: right-click this file > Open. Add --lan to share on your network.
cd "$(dirname "$0")/search" || exit 1
if ! command -v uv >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/uv" ]; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
UV="$(command -v uv || echo "$HOME/.local/bin/uv")"
export UV_NATIVE_TLS=1
if [ ! -x ".venv/bin/python" ]; then
  echo; echo "  First run: setting up Python and packages (5-10 minutes, once)."; echo
  "$UV" venv --python 3.12 .venv && "$UV" pip install --python .venv/bin/python -r requirements.txt || {
    echo "  Setup failed. You can still open web/index.html: everything except typed search works."; exit 1; }
fi
.venv/bin/python server.py "$@"
