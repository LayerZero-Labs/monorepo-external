#!/bin/sh
# Run inside the repo VM. Build the actual program before executing its SBF scenarios, into
# test-deploy so a test build is never mistaken for the release .so paired with target/idl.
set -eu
export RUST_LOG="${RUST_LOG:-off}"
# Same platform-tools and SBPF version as `anchor build` 1.2.x, so tests run what deploys.
cargo build-sbf --tools-version v1.57 --arch v3 --manifest-path programs/pubkey_policy/Cargo.toml \
    --sbf-out-dir target/test-deploy -- --locked
cargo test -p pubkey-policy-integration-tests --locked
