# @layerzerolabs/lz-v2-protocol-solana-v3

Executor V3 discovery (`lz_*_types_info` / `lz_*_types_v3`) and Solana Transaction V1 helpers, with
no Anchor build and no generated program code, so offchain workers can depend on it without pulling
the Solana programs into their build.

`@layerzerolabs/lz-v2-protocol-solana` re-exports everything here (root and `/v3` entries); see its
[README](../lz-v2-protocol-solana/README.md#executor-v3-and-transaction-v1-v3) for how discovery
works. Unit tests live there too.
