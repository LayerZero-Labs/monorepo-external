#!/bin/sh
# Copy the hook and pubkey-policy programs from their own packages' builds (their lockfiles and
# release profiles) into target/test-deploy for the cross-program suite. Runs on the host: the
# lz-tool mount excludes other packages' sources and builds.
set -eu
mkdir -p target/test-deploy
copy() {
    root=$(node -p "require('path').dirname(require.resolve('$1/package.json'))")
    cp "$root/target/deploy/$2.so" target/test-deploy/
}
copy @layerzerolabs/pubkey-policy-hook-solana-contracts pubkey_policy_hook
copy @layerzerolabs/pubkey-policy-solana-contracts pubkey_policy
