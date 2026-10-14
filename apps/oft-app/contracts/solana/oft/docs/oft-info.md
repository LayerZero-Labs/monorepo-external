# OFT Info

This document describes the current `oft::oft_info` implementation. The higher-level OFT Info theory lives in the design spec; this file focuses on the concrete Rust entry.

## Entry

`OftInfo` is the OFT-family entry inside the flat `OAppInfo` TLV account. It does not describe a concrete OFT implementation; it carries the OFT layer's schema version and the discriminator that routes to a project-specific TLV entry.

```rust
pub const OFT_INFO_SCHEMA_VERSION: u8 = 1;

#[discriminator_hash_input("oft::info")]
pub struct OftInfo {
    pub schema_version: u8,
    pub project_discriminator: [u8; 8],
}
```

`OftInfo::new(project_discriminator)` constructs the entry at the current schema version. The caller is responsible for supplying the SPL discriminator of the project entry that will be appended in the same `OAppInfo` account.

## Standard Console OFT Use

Console OFT initializes the OFT-family route as:

```text
OAppBase.app_discriminator -> OftInfo
OftInfo.project_discriminator -> ConsoleOftInfo
```

The implementation call sequence (see `console_oft::console_oft_info::init_console_oft_info`) uses only base `oapp` primitives:

```rust
oapp::init_oapp_base!(info, OftInfo);
oapp::oapp_info::init_tlv_entry(info, &OftInfo::new(ConsoleOftInfo::SPL_DISCRIMINATOR.into()))?;
oapp::oapp_info::init_tlv_entry(info, &ConsoleOftInfo::default())?;
```

`init_oapp_base!` writes `OAppBase` and sets its `app_discriminator` to `OftInfo`'s SPL discriminator. The second call writes the `OftInfo` entry with its `project_discriminator` slot pre-filled to point at `ConsoleOftInfo`. The third call writes the `ConsoleOftInfo` leaf.
