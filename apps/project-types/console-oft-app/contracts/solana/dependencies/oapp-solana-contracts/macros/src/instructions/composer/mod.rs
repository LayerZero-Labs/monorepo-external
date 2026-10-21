//! Composer instruction definitions and code generation.
//!
//! Each sub-module defines a `spec()` returning the instruction's codegen descriptor.
//! `InstructionName::spec()` maps instruction variants to their specs.

mod lz_compose;
mod lz_compose_types_info;
mod lz_compose_types_v3;

use anchor_trait::declare_instructions;

/// Domain-specific context for Composer code generation.
/// Currently a unit struct — all instructions are required with no defaults.
pub(crate) struct ComposerCodegenContext;

declare_instructions! {
    name    = ComposerInstructionSet;
    context = ComposerCodegenContext;

    LzComposeTypesInfo => lz_compose_types_info,
    LzComposeTypesV3   => lz_compose_types_v3,
    LzCompose          => lz_compose,
}
