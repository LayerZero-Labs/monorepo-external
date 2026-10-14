#!/usr/bin/env bash
# Regression test for the bug this crate exists to prevent: a proc macro that reads an environment
# variable is invisible to cargo's fingerprint, so a build with a changed ID can silently re-emit
# the previous one. Asserts both halves of the property — the ID follows when the variable changes,
# and the crate stays fresh when it does not, so the marker cannot be forcing an unconditional
# rebuild and quietly destroying incremental builds.
set -euo pipefail

cd "$(dirname "$0")/.."

A="11111111111111111111111111111112"
B="9UovNrJD8pQyBLheeHNayuG1wJSEAoxkmM14vw5gcsTT"

build_log=$(mktemp)
trap 'rm -f "$build_log"' EXIT

observed_id=""
recompiled=""

run_probe() {
    # --quiet would suppress the "Compiling" line this test reads, so keep cargo verbose on stderr
    # and take only the probe's own stdout as the baked-in ID.
    observed_id=$(PROBE_ID="$1" cargo run --locked -p probe 2>"$build_log")
    if grep -q "Compiling probe" "$build_log"; then recompiled="yes"; else recompiled="no"; fi
}

# $1 label | $2 PROBE_ID | $3 expected ID | $4 expected recompile (yes/no)
assert_build() {
    run_probe "$2"

    if [ "$observed_id" != "$3" ]; then
        echo "FAIL: $1 baked in '$observed_id', expected '$3'." >&2
        echo "      cargo did not pick up the new PROBE_ID. The option_env! marker in" >&2
        echo "      lib/src/lib.rs is what makes the fingerprint track it." >&2
        exit 1
    fi

    if [ "$recompiled" != "$4" ]; then
        if [ "$4" = "yes" ]; then
            echo "FAIL: $1 reused a stale build; expected cargo to recompile." >&2
        else
            echo "FAIL: $1 recompiled; expected cargo to leave it fresh." >&2
            echo "      The marker must invalidate on change only, not on every build." >&2
        fi
        exit 1
    fi

    echo "ok: $1"
}

# Start from a known-cold probe so the first row is deterministic when run repeatedly.
cargo clean --quiet -p probe

assert_build "PROBE_ID=A (cold)"  "$A" "$A" yes
assert_build "PROBE_ID=A (again)" "$A" "$A" no
assert_build "PROBE_ID=B"         "$B" "$B" yes
assert_build "PROBE_ID=B (again)" "$B" "$B" no
assert_build "PROBE_ID=A (back)"  "$A" "$A" yes

echo "PASS: PROBE_ID tracked precisely — rebuilds on change, stays fresh otherwise"
