#!/usr/bin/env bash
# Host-side runner. These tests mock cargo/anchor and only need python3 + base58.
set -euo pipefail
cd "$(dirname "$0")"

req="requirements/test.txt"
venv="${TMPDIR:-/tmp}/lz-add-address-idl-venv"
stamp="$venv/.req-sha256"
want="$( { sha256sum "$req" 2>/dev/null || shasum -a 256 "$req"; } | cut -d' ' -f1 )"

if [[ ! -x "$venv/bin/python" || "$(cat "$stamp" 2>/dev/null)" != "$want" ]]; then
    rm -rf "$venv"
    python3 -m venv "$venv"
    "$venv/bin/pip" install --require-hashes --no-deps -r "$req"
    echo "$want" > "$stamp"
fi

"$venv/bin/python" -m unittest discover -s . -p 'test_*.py' -v
