#!/usr/bin/env bash
# Regression test for a bug this macro's first draft had: `add_address_to_idl.py` (in the anchor
# image) recovers a program's real address from `cargo expand`. `anchor idl build` cannot evaluate
# a non-literal declare_id!, so that repair step is the only thing standing between an env-derived
# ID and a garbage `address` field in the IDL. Hosting the option_env! marker inside the array
# expression breaks the match and silently reinstates the garbage, so assert the shipped matcher
# recovers the probe's declared ID rather than discovering it downstream.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! cargo expand --version >/dev/null 2>&1; then
    echo "FAIL: cargo-expand is not installed, so the shape cannot be checked." >&2
    echo "      It ships in the anchor image; run this via 'pnpm test:idl-shape'." >&2
    exit 1
fi

EXPECTED_ID="11111111111111111111111111111111"
expanded=$(PROBE_ID="$EXPECTED_ID" cargo expand -p probe 2>/dev/null)

recovered=$(PYTHONPATH=/usr/local/bin python3 -c \
    'import sys; from add_address_to_idl import compiled_program_address; print(compiled_program_address(sys.stdin.read()) or "")' \
    <<<"$expanded")

if [ "$recovered" != "$EXPECTED_ID" ]; then
    echo "FAIL: add_address_to_idl.py recovered '$recovered', expected '$EXPECTED_ID'." >&2
    echo "      The expansion no longer matches the shipped matcher, or the matcher returned the wrong address." >&2
    grep -A3 'pub static ID:' <<<"$expanded" >&2 || true
    exit 1
fi

echo "PASS: shipped matcher recovered the probe's declared ID"
