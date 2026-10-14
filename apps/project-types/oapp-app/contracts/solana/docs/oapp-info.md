# OApp Info

`OAppInfo` is the program-level metadata PDA an OApp publishes so a generic SDK can resolve
accounts for the standard instruction set from a single account read. Source:
[`oapp_info.rs`](../src/oapp_info.rs). For why it exists, see the Motivation section in
[`README.md`](../README.md).

## PDA

| Property | Value                                                  |
| -------- | ------------------------------------------------------ |
| Seeds    | `[b"OAppInfo"]` (`OAPP_INFO_SEED`)                     |
| Scope    | One per program — `find_program_address` namespaces it |
| Owner    | The publishing program                                 |
| Layout   | Raw SPL TLV from byte 0; **no** Anchor discriminator   |

Creation is application-owned. `#[oapp]` generates the instruction surface but never creates this
PDA; a program that wants standardized discovery allocates and populates it in its own
initialization flow. A program without the PDA is outside standardized discovery and needs
program-specific client logic.

## Storage model

Each entry is `[ type: 8 bytes | length: u32 | Borsh value ]`. Entries are flat siblings: every
layer appends its own type, and a consumer decodes by discriminator without walking the buffer in
order. The `TlvSpace` trait gives any `InitSpace + SplDiscriminate` type a `TLV_SPACE` constant
(12-byte header plus value bytes) for sizing the containing account.

### Entries

| Entry            | Discriminator hash  | Route field             | Versions          | Source                                                                                                             |
| ---------------- | ------------------- | ----------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `OAppBase`       | `oapp::base`        | `app_discriminator`     | schema 1, IDL 2.0 | [`oapp_info.rs`](../src/oapp_info.rs)                                                                              |
| `OftInfo`        | `oft::info`         | `project_discriminator` | schema 1          | [`oft_info.rs`](../../../../../oft-app/contracts/solana/oft/src/oft_info.rs)                                       |
| `ConsoleOftInfo` | `console-oft::info` | leaf                    | schema 1, IDL 2.0 | [`console_oft_info.rs`](../../../../console-oft-app/contracts/solana/programs/console_oft/src/console_oft_info.rs) |

`NO_APP_DISCRIMINATOR` (`[0; 8]`) in `app_discriminator` means no app entry follows.

## OAppBase

The framework entry, always present. It carries two orthogonal version axes plus the pointer to the
app-layer sibling.

| Field               | What it versions                                                                      |
| ------------------- | ------------------------------------------------------------------------------------- |
| `schema_version`    | The Borsh layout of this entry's own value bytes. Read it first to pick a parser.     |
| `idl_version`       | The instruction and event contract: account templates, params, returns, event fields. |
| `app_discriminator` | Which sibling entry the app layer wrote, if any.                                      |

Splitting the axes lets an account-template or event-field change bump `idl_version` while every
byte parser stays valid, and lets a consumer declare an independent compatibility range on each.

All three fields are determined by the program binary, so every instance of a program reports
identical values and a consumer may cache the parsed entry per program ID.

**v1 compatibility constraint.** A program publishing `OAppInfo` at `schema_version = 1` must keep
the account contexts of the standard instructions it provides identical to the templates its
`idl_version` advertises. `oapp_extend_accounts!` and full `#[oapp_instruction]` account overrides
(see [`oapp-macro.md`](./oapp-macro.md)) stay available, but only for programs resolved through
program-specific client logic — they must not change what a generic consumer derives from
`OAppInfo` v1. `schema_version = 1` defines no per-instruction override metadata; introducing one
bumps the schema to 2, and v1 deployments keep the all-standard reading.

### `schema_version` bump rules

| Change                                                        | Bump | Note                                  |
| ------------------------------------------------------------- | ---- | ------------------------------------- |
| Add, remove, or reorder a field in `OAppBase` or `IdlVersion` | Yes  |                                       |
| Change a field's type or byte size                            | Yes  |                                       |
| Rename a field                                                | No   | Borsh ignores field names             |
| Change logic, comments, or documentation                      | No   |                                       |
| Add a sibling TLV entry from another layer                    | No   | Each sibling carries its own versions |

A bump tells a consumer its parser may no longer match. Deployed programs are not redeployed, so a
consumer must keep every previously published `schema_version` readable.

### `idl_version` bump rules

`idl_version` is `{ major: u8, minor: u8 }`. **major** means old templates and event parsers can no
longer be trusted; **minor** means additive only.

| Change                                                                               | Bump  | Note                                |
| ------------------------------------------------------------------------------------ | ----- | ----------------------------------- |
| Change an existing instruction's account template (added/removed/reordered/reseeded) | major |                                     |
| Change an existing instruction's param or return type                                | major |                                     |
| Rename or remove an existing instruction                                             | major | The Anchor discriminator changes    |
| Change an existing event's fields                                                    | major | Indexers on the old layout break    |
| Rename or remove an existing event                                                   | major | The Anchor discriminator changes    |
| Add an instruction or an event                                                       | minor | `OAppBase`'s shape is unchanged     |
| Change a handler's internals without touching accounts, signature, or event fields   | No    |                                     |
| Rename instruction-param or event-struct fields; comment or doc changes              | No    | Borsh ignores field names           |
| Change confined to another TLV layer                                                 | No    | Each sibling versions independently |

A consumer built for `major = 1` and minors through `K` can operate on any `(1, minor)` deployment:
templates and event layouts it already knows stay valid, and it simply cannot construct calls or
parse events introduced after `K`.

## Consumer flow

1. Derive `[b"OAppInfo"]` under the program ID. Absent → program-specific client logic.
2. Decode `OAppBase` by discriminator; check `schema_version` and `idl_version.major` against the
   supported range.
3. For a standard instruction, look up the template by instruction name — within a `major`,
   templates for known instructions are stable. An unknown name means the deployment is ahead of
   the consumer.
4. For app- or project-layer metadata, follow `app_discriminator` to the app entry and recurse on
   that entry's own route field.
5. Derive accounts from PDA seeds, the target instance's state account, and params, then build the
   call.

Instructions with a generated default implementation resolve from the template. The three with no
default do not. `lz_receive_types_info` has a fixed two-account shape the handler must match;
`lz_receive_types_v3` takes a fixed prefix plus the app inputs that call returns; and `lz_receive`
takes whatever the plan `lz_receive_types_v3` writes contains. See
[`lz-receive-types.md`](./lz-receive-types.md).

## Writing entries

| Operation                  | Rule                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `init_oapp_base!(info)`    | Writes `OAppBase` with `NO_APP_DISCRIMINATOR`.                                                                                                                           |
| `init_oapp_base!(info, T)` | Writes `OAppBase` pointing at `T`. It does **not** write `T` — the same initialization path must, or the account advertises a missing sibling.                           |
| `init_tlv_entry`           | Allocates and writes one entry. Fails if the type already exists. Requires a freshly allocated, zero-filled account in the same instruction (Anchor `#[account(init)]`). |
| `update_tlv_entry`         | Overwrites in place. Returns `TlvLengthMismatch` unless the packed length is identical, so a variable-length field cannot change size after initialization.              |

The `init_tlv_entry` precondition is load-bearing: the TLV parser stops at the first all-zero
discriminator and never scans past it, so a reused or partially written account can hide residual
entries.

## Defining an app entry

An app entry is any struct deriving `SplDiscriminate` and `SplBorshVariableLenPack`. `OAppInfo`
imposes only:

- a unique 8-byte discriminator, colliding with no other reachable sibling;
- a Borsh value that round-trips through `spl-type-length-value`;
- every field derivable from the program binary alone — per-instance configuration belongs on the
  instance's own state accounts.

The internal shape is the app's choice. Nothing requires it to mirror `OAppBase` or to carry
version fields at all; `OftInfo`, for example, carries a `schema_version` but no `idl_version`.

## Relationship with LzReceiveTypes

| Aspect          | OAppInfo                                       | LzReceiveTypes                                        |
| --------------- | ---------------------------------------------- | ----------------------------------------------------- |
| Scope           | Standard OApp instructions except `lz_receive` | `lz_receive` exclusively                              |
| Granularity     | Program-level, one PDA per program             | Per-instance; the account list depends on the message |
| Version concept | `schema_version` + `idl_version`               | `lz_receive_types_info`                               |
| Resolution      | Off-chain templates                            | On-chain, via `lz_receive_types_v3`                   |

The two are independent. `lz_receive` accounts are message-dependent and cannot come from a
program-level template, so the planner resolves them on-chain and self-describes its own version.
