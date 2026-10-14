#!/bin/sh
# The generic snapshot tool can succeed with a partially populated output tree.
# Require every production artifact; ignore unrelated or stale local artifacts.
set -eu

for artifact in target/deploy/pubkey_policy_hook.so target/idl/pubkey_policy_hook.json target/types/pubkey_policy_hook.ts; do
    if [ ! -s "$artifact" ]; then
        echo "Missing or empty build artifact: $artifact (run pnpm build first)" >&2
        exit 1
    fi
done
