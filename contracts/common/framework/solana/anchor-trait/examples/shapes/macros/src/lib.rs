//! Procedural macros for the Shapes example program.
//!
//! Provides `#[shapes]` and `#[shapes_instruction]` attribute macros
//! demonstrating the anchor-trait instruction trait system.

mod audit;
mod instructions;
mod shapes;
mod state_types;

use proc_macro::TokenStream;

/// Program-level macro that auto-generates shape instruction entrypoints.
///
/// Generates `ShapeState` in the module prelude.
///
/// ## Usage
///
/// ```ignore
/// #[shapes_macros::shapes]
/// pub mod shapes_program {
///     // Required: must provide initialize, get_name, get_dimension, clear
///     // Optional: override compute_area, compute_perimeter, scale, reset, get_dimension_count
/// }
/// ```
#[proc_macro_attribute]
pub fn shapes(attr: TokenStream, item: TokenStream) -> TokenStream {
    shapes::expand(attr.into(), item.into())
        .unwrap_or_else(|err| err.to_compile_error())
        .into()
}

#[proc_macro_attribute]
pub fn shapes_audit(attr: TokenStream, item: TokenStream) -> TokenStream {
    audit::expand(attr.into(), item.into())
        .unwrap_or_else(|err| err.to_compile_error())
        .into()
}

/// Marks a function as an override for a shapes instruction.
///
/// ## Usage
///
/// ```ignore
/// #[shapes_instruction(compute_area)]
/// pub fn triangle_area(ctx: Context<StdComputeArea>, _params: ComputeParams) -> Result<u64> {
///     // custom logic
/// }
/// ```
#[proc_macro_attribute]
pub fn shapes_instruction(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}
