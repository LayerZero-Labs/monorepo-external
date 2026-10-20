#!/bin/bash
set -euo pipefail

log=$(mktemp)
trap 'rm -f "$log"' EXIT

"$@" 2>&1 | tee "$log"

if grep -q 'overflows the maximum allowed frame space' "$log"; then
    echo 'error: a function overflows its 4 KiB SBF stack frame (see above); move large locals or CPI builders into an #[inline(never)] function or onto the heap' >&2
    exit 1
fi
