use proc_macro::TokenStream;

mod instructions;
mod oft;

/// Attribute macro for generating OApp program entrypoints via the new oapp2 pipeline.
///
/// This macro is introduced as a clean-slate path and is intentionally separate
/// from `#[oapp]`.
///
/// # Attributes
///
/// - `state = <path>`: required. The OFT program state account type.
/// - `role_type = <path>`: required. The RBAC role enum type.
///
/// The role enum should implement `rbac::RoleType`. With the built-in derive,
/// the `#[default]` variant is the default-admin role and must use discriminant
/// `0`.
///
/// ```ignore
/// #[oft(state = OFTStore, role_type = crate::RoleType)]
/// mod oft_instructions {}
/// ```
#[proc_macro_attribute]
pub fn oft(attr: TokenStream, item: TokenStream) -> TokenStream {
    oft::expand(attr.into(), item.into())
        .unwrap_or_else(|err| err.to_compile_error())
        .into()
}

/// This attribute is used to override the default OFT instruction handlers.
///
/// The attribute itself is a no-op; `#[oft]` detects it and routes the
/// overridden handler into generated instruction entrypoints.
#[proc_macro_attribute]
pub fn oft_instruction(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}
