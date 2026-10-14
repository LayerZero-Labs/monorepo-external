use proc_macro::TokenStream;

mod composer;
mod instructions;
mod oapp;
mod state_types;

/// Attribute macro for generating OApp program entrypoints.
///
/// Uses the `anchor-trait` collect → generate → assemble pipeline to emit all
/// standard OApp instructions.  Instructions with a framework-provided default
/// (e.g. `set_peer`, `set_enforced_options`) are generated automatically; instructions
/// without a default (e.g. `lz_receive`) must be supplied by the implementor
/// via `#[oapp_instruction]`.  The `#[program]` attribute is always emitted by
/// the assembly layer — callers never need to add it manually.
#[proc_macro_attribute]
pub fn oapp(attr: TokenStream, item: TokenStream) -> TokenStream {
    oapp::expand(attr.into(), item.into())
        .unwrap_or_else(|err| err.to_compile_error())
        .into()
}

/// Marker attribute for custom OApp instruction handlers.
///
/// Place this on a function inside the `#[oapp]` module to supply a custom
/// handler for the named instruction.  The handler's `ctx` parameter must be
/// taken **by reference** (`&Context<T>`).
///
/// The body of this stub is unreachable: `#[oapp]` consumes the enclosing
/// module token stream and strips this marker before rustc sees it.
/// Override logic lives in `oapp::expand`.
///
/// # Security: `lz_receive`
///
/// When overriding `lz_receive`, the handler MUST verify that
/// `(params.src_eid, params.sender)` corresponds to a registered peer — the
/// Endpoint does NOT perform this check. The recommended pattern binds the
/// `OAppPeer` PDA to `params.src_eid` via `seeds` and enforces
/// `peer.address == params.sender` declaratively with `constraint`:
///
/// ```ignore
/// #[account(
///     seeds = [::oapp::PEER_SEED, oapp.key().as_ref(), &params.src_eid.to_be_bytes()],
///     bump = peer.bump,
///     constraint = peer.address == params.sender,
/// )]
/// pub peer: Account<'info, OAppPeer>,
/// ```
#[proc_macro_attribute]
pub fn oapp_instruction(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}

/// Attribute macro for generating Composer program entrypoints.
///
/// This macro generates `lz_compose`, `lz_compose_types_v3`, and
/// `lz_compose_types_info` instruction entrypoints for programs that implement
/// the LayerZero composer interface.  All three instructions are required —
/// the implementor must provide custom handlers for each via
/// `#[composer_instruction]`.  The `#[program]` attribute is emitted
/// automatically by the assembly layer.
#[proc_macro_attribute]
pub fn composer(attr: TokenStream, item: TokenStream) -> TokenStream {
    composer::expand(attr.into(), item.into())
        .unwrap_or_else(|err| err.to_compile_error())
        .into()
}

/// Marker attribute for required Composer instruction handlers.
///
/// All three instructions (`lz_compose`, `lz_compose_types_v3`, `lz_compose_types_info`)
/// must be provided — there are no framework-supplied defaults.  Each handler's
/// `ctx` parameter must be taken **by reference** (`&Context<T>`).
///
/// The body of this stub is unreachable: `#[composer]` consumes the enclosing
/// module token stream and strips this marker before rustc sees it.
/// Override logic lives in `composer::expand`.
///
/// # Security: `lz_compose`
///
/// The handler MUST verify that `params.from` is an OApp it trusts. Anyone can
/// queue a compose message with the Endpoint's `send_compose`, which records
/// its signer as `from`; `clear_compose` only proves the message came from
/// `params.from`, not that the sender is trusted. Bind the trusted sender
/// (e.g. the OFT store whose receives queue these messages) in the composer's
/// state and check it declaratively:
///
/// ```ignore
/// #[account(
///     seeds = [COMPOSER_SEED],
///     bump = composer_store.bump,
///     constraint = composer_store.key() == params.to,
///     constraint = composer_store.oft_store == params.from,
/// )]
/// pub composer_store: Account<'info, ComposerStore>,
/// ```
#[proc_macro_attribute]
pub fn composer_instruction(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}
