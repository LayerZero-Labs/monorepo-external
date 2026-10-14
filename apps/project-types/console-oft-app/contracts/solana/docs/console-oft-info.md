# Console OFT Info

`ConsoleOftInfo` is the project leaf of the `OAppInfo` TLV chain that `console_oft` publishes.
Source: [`console_oft_info.rs`](../programs/console_oft/src/console_oft_info.rs).

For the TLV container, its write primitives and the `OAppBase` versioning rules, see
[`oapp-info.md`](../../../../oapp-app/contracts/solana/docs/oapp-info.md). For the OFT-family
route entry, see [`oft-info.md`](../../../../../oft-app/contracts/solana/oft/docs/oft-info.md).

## Entry

| Property           | Value                              |
| ------------------ | ---------------------------------- |
| Discriminator hash | `console-oft::info`                |
| Schema version     | 1                                  |
| IDL version        | 2.0                                |
| Reached from       | `OftInfo.project_discriminator`    |
| Scope              | Program-level — one per program ID |

## Discovery

1. Derive the `OAppInfo` PDA: `find_program_address([b"OAppInfo"], console_oft_program_id)`.
2. Decode `OAppBase`; follow `app_discriminator` to `OftInfo`.
3. Decode `OftInfo`; follow `project_discriminator` to `ConsoleOftInfo`.
4. Read `schema_version` first to pick the parser, then `idl_version` to decide compatibility.

All three entries are siblings in the same account, so the chain costs one account read.

## Versioning contract

`schema_version` covers only the Borsh layout of this entry's value bytes. `idl_version` covers the
whole project IDL surface of `console_oft` — instructions and events alike; there is no separate
track per category. Both follow the `OAppBase` bump rules in
[`oapp-info.md`](../../../../oapp-app/contracts/solana/docs/oapp-info.md), applied to this
entry's struct and to `console_oft`'s own instruction and event set.

Each sibling entry carries its own versions and is parsed independently: a bump here says nothing
about `OAppBase` or `OftInfo`, and a bump there says nothing about this entry.

A consumer may rely on:

- the discriminator and the route reaching it being fixed for the program's lifetime;
- every field being derivable from the program binary — every deployment of a given `console_oft`
  build reports identical values;
- instruction templates and event layouts staying stable within an `idl_version.major`.

Per-instance configuration is not here. Burn-vs-lock (`OFTStore.oft_type`), limits and fee settings
live on the instance state accounts.

## Initialization

`init_console_oft_info`
([source](../programs/console_oft/src/instructions/init_console_oft_info.rs)) allocates the
`OAppInfo` PDA and writes all three entries in one call. It uses Anchor `init`, not
`init_if_needed`, so it succeeds exactly once per program deployment and the published metadata
cannot be rewritten afterwards. The entries therefore describe the build that ran it: a change that
bumps `idl_version` ships as a new program, not an in-place upgrade, which would keep reporting the
old versions.

Account space is `OAppBase::TLV_SPACE + OftInfo::TLV_SPACE + ConsoleOftInfo::TLV_SPACE`; adding a
field to any of the three changes the required allocation and therefore needs a new deployment.
