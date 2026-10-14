//! OApp instruction definitions and code generation.
//!
//! Each sub-module defines a `spec()` returning the instruction's codegen descriptor.
//! `InstructionName::spec()` maps instruction variants to their specs.

pub(crate) mod accept_default_admin_transfer;
mod burn;
mod clear;
mod get_enforced_options;
mod get_peer;
mod init_enforced_options;
mod is_compose_msg_sender;
mod lz_receive;
mod lz_receive_types_info;
mod lz_receive_types_v3;
mod next_nonce;
mod nilify;
mod set_enforced_options;
mod set_peer;
mod skip;

use anchor_trait::declare_instructions;
use proc_macro2::TokenStream;

/// Domain-specific context carrying resolved types for OApp code generation.
pub(crate) struct CodegenContext {
    pub role_type: TokenStream,
    pub oapp_type: TokenStream,
}

declare_instructions! {
    name    = OAppInstructionSet;
    context = CodegenContext;

    SetPeer              => set_peer,
    GetPeer              => get_peer,
    InitEnforcedOptions  => init_enforced_options,
    SetEnforcedOptions   => set_enforced_options,
    GetEnforcedOptions   => get_enforced_options,
    NextNonce            => next_nonce,
    IsComposeMsgSender   => is_compose_msg_sender,
    LzReceiveTypesInfo   => lz_receive_types_info,
    LzReceiveTypesV3     => lz_receive_types_v3,
    LzReceive            => lz_receive,
    Clear                => clear,
    Skip                 => skip,
    Burn                 => burn,
    Nilify               => nilify,
}
