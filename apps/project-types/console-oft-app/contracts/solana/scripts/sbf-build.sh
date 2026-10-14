#!/bin/bash
# Run an SBF build command and fail if any function overflows its stack frame.
#
# LLVM reports "Error: Function ... overflows the maximum allowed frame space" but the build still
# exits 0. SBPF v3 frames are a fixed 4 KiB with no unmapped gap between them, so an overflowing
# function silently writes into its caller's frame instead of faulting.
set -euo pipefail

log=$(mktemp)
trap 'rm -f "$log"' EXIT

"$@" 2>&1 | tee "$log"

if grep -q 'overflows the maximum allowed frame space' "$log"; then
    echo 'error: a function overflows its 4 KiB SBF stack frame (see above); move large locals or CPI builders into an #[inline(never)] function or onto the heap' >&2
    exit 1
fi
