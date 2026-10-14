#!/bin/sh
# The generic snapshot tool can succeed with a partially populated output tree.
# Require every production artifact; ignore unrelated or stale local artifacts.
set -eu

for program in token_manager; do
    for artifact in "target/deploy/$program.so" "target/idl/$program.json" "target/types/$program.ts"; do
        if [ ! -s "$artifact" ]; then
            echo "Missing or empty build artifact: $artifact (run pnpm build first)" >&2
            exit 1
        fi
    done
done

for fixture in token_acl_fixture token_2022_fixture; do
    if [ ! -s "target/deploy/$fixture.so" ]; then
        echo "Missing or empty fixture artifact: target/deploy/$fixture.so (run pnpm build first)" >&2
        exit 1
    fi
done

node scripts/check-governance-idl.mjs
