//! Code generator for the `lz_receive` instruction.
//!
//! This instruction has no default implementation — users MUST provide
//! a custom handler named `lz_receive` with `#[oapp_instruction]`.
//!
//! # Security
//!
//! The handler MUST verify that `(params.src_eid, params.sender)` corresponds
//! to a registered peer — the Endpoint does not perform this check. Bind the
//! `OAppPeer` PDA to `params.src_eid` via `seeds` and enforce
//! `peer.address == params.sender` declaratively with `constraint`:
//!
//! ```ignore
//! #[account(
//!     seeds = [::oapp::PEER_SEED, oapp.key().as_ref(), &params.src_eid.to_be_bytes()],
//!     bump = peer.bump,
//!     constraint = peer.address == params.sender,
//! )]
//! pub peer: Account<'info, OAppPeer>,
//! ```

use super::CodegenContext;
use anchor_trait::InstructionSpec;
use quote::quote;

pub(super) fn spec() -> InstructionSpec<CodegenContext> {
    InstructionSpec {
        params_type: Some(quote!(::oapp::types::LzReceiveParams)),
        return_type: quote!(()),
        is_view: false,
        default_impl: None,
    }
}
