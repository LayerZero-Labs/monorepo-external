#!/bin/sh
# Build the SBF programs used by OFT's Mollusk and cross-program tests.
# Called by pnpm build:test-fixtures (shared by test:rust and test:policy).
# All outputs stay in this package; installed dependencies are read-only inputs.
set -eu

pnpm resolve-dependencies

# Programs owned by other packages come from those packages' builds, with their lockfiles and
# release profiles, never rebuilt from the vendored sources: the manager, hook and pubkey-policy
# programs through artifacts:copy, and the Token ACL and Token-2022 fixtures (not Anchor programs,
# so without the IDL artifacts:copy requires) from the token-manager build directly.
pnpm artifacts:copy
mkdir -p target/test-deploy
for program in token_manager pubkey_policy_hook pubkey_policy; do
    cp "artifacts/$program.so" target/test-deploy/
done
token_manager_root=$(node -p "require('path').dirname(require.resolve('@layerzerolabs/token-manager-solana-contracts/package.json'))")
for fixture in token_acl_fixture token_2022_fixture; do
    cp "$token_manager_root/target/deploy/$fixture.so" target/test-deploy/
done

# Shared test tooling supplies the versioned Endpoint artifact; do not download
# an unpinned replacement or depend on a leftover local binary.
pnpm exec tsx -e '
    import { globalSetup } from "@layerzerolabs/test-utils-solana";
    globalSetup().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
'

# Compile the actual programs under test through VM tooling, never host Cargo, with the same
# platform-tools and SBPF version as `anchor build` 1.2.x so tests run what deploys.
# --locked checks this package's own lockfile. cargo build-sbf rebuilds changed
# sources, so the programs compiled here are never stale; the ones copied above are only as
# fresh as their packages' last build. Fixtures stay out of target/deploy, the build's declared
# output.
pnpm exec lz-tool --script '
    set -eu

    # The OFT program whose policy integration these fixtures exercise.
    cargo build-sbf --tools-version v1.57 --arch v3 \
        --manifest-path programs/console_oft/Cargo.toml \
        --sbf-out-dir target/test-deploy -- --locked

    # Composer that forwards received tokens, proving a composer plans its own
    # create-and-thaw for a destination the OFT knows nothing about.
    cargo build-sbf --tools-version v1.57 --arch v3 \
        --manifest-path tests/programs/forwarding_composer/Cargo.toml \
        --sbf-out-dir target/test-deploy -- --locked

    # Native hook contract variants: absent/empty manifests and destination-key/data seeds.
    cargo build-sbf --tools-version v1.57 --arch v3 \
        --manifest-path tests/programs/transfer_hook_fixture/Cargo.toml \
        --sbf-out-dir target/test-deploy -- --locked

    # Composer that re-sends received tokens onto a second hop, for measuring how much
    # of the Transaction V1 64-address budget a compose-then-send plan consumes.
    cargo build-sbf --tools-version v1.57 --arch v3 \
        --manifest-path tests/programs/multihop_composer/Cargo.toml \
        --sbf-out-dir target/test-deploy -- --locked
' anchor
