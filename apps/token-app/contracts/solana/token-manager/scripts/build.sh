#!/bin/sh
# Runs inside the Anchor VM. Macro-derived addresses need repairing in JSON
# before generating the TypeScript types, otherwise their address literals differ.
set -eu

# The workspace also builds the Token ACL and Token-2022 fixtures, which are not Anchor programs
# and have no IDL; only token_manager's IDL is generated.
anchor build --ignore-keys --no-idl
mkdir -p target/idl
anchor idl build -p token_manager -o target/idl/token_manager.json
add_address_to_idl.py
# Each fixture is its own Cargo workspace (its own lockfile and release profile), so Anchor writes
# its binary under that workspace; publish both next to token_manager for consumers.
cp fixtures/token_acl/target/deploy/token_acl_fixture.so fixtures/token_2022/target/deploy/token_2022_fixture.so target/deploy/
for program in token_manager; do
    anchor idl type "target/idl/$program.json" --out "target/types/$program.ts"
done
