//! Shapes instruction definitions and code generation.

mod clear;
mod compute_area;
mod compute_perimeter;
mod get_dimension;
mod get_dimension_count;
mod get_name;
mod initialize;
mod reset;
mod scale;

use anchor_trait::declare_instructions;
use proc_macro2::TokenStream;

/// Domain-specific context carrying the resolved state type for shapes code generation.
pub(crate) struct CodegenContext {
    pub state_type: TokenStream,
}

declare_instructions! {
    name    = ShapesInstructionSet;
    context = CodegenContext;

    Initialize       => initialize,
    GetName          => get_name,
    GetDimension     => get_dimension,
    Clear            => clear,
    ComputeArea      => compute_area(ctx),
    ComputePerimeter => compute_perimeter(ctx),
    GetDimensionCount => get_dimension_count(ctx),
    Scale            => scale(ctx),
    Reset            => reset(ctx),
}
