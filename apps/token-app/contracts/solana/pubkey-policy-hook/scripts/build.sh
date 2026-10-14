#!/bin/sh
# Runs inside the Anchor VM. Macro-derived addresses need repairing in JSON
# before generating the TypeScript types, otherwise their address literals differ.
set -eu

anchor build --ignore-keys
add_address_to_idl.py
anchor idl type target/idl/pubkey_policy_hook.json --out target/types/pubkey_policy_hook.ts
