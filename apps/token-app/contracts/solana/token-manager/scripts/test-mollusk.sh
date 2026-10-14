#!/bin/sh
# Run inside the repo VM. Build the manager and the pinned upstream processors before executing
# cross-program tests; no cached bundled PB substitute. The hook and pubkey-policy programs come
# from their own packages' builds, staged by scripts/copy-program-builds.sh.
set -eu
export RUST_LOG="${RUST_LOG:-off}"
# Same platform-tools and SBPF version as `anchor build` 1.2.x, so tests run what deploys.
for manifest in \
    programs/token_manager/Cargo.toml \
    fixtures/token_acl/Cargo.toml \
    fixtures/token_2022/Cargo.toml
do
    cargo build-sbf --tools-version v1.57 --arch v3 --manifest-path "$manifest" \
        --sbf-out-dir target/test-deploy -- --locked
done
cargo test -p token-app-integration-tests --locked
