use proc_macro2::TokenStream;
use quote::quote;
use syn::{parse_quote, spanned::Spanned, ExprLit, Fields, ItemEnum, Lit, Token};

pub fn generate_error(item: TokenStream) -> TokenStream {
    let mut data_enum: ItemEnum = syn::parse2(item).unwrap_or_else(|e| panic!("failed to parse enum: {}", e));

    // For variants without an explicit discriminant, assign sequential error codes starting at 1
    // (by initializing the counter to 0 and incrementing before assignment).
    let mut current_value = 0;
    for variant in &mut data_enum.variants {
        assert!(matches!(variant.fields, Fields::Unit), "Error enum variants must be unit variants");

        // Handle variant discriminant assignment
        if let Some((_, disc)) = &variant.discriminant {
            // Explicit discriminant - validate it's greater than previous and update counter
            let val = parse_discriminant_value(disc);
            assert!(val > current_value, "Error enum discriminant must be greater than the previous discriminant");
            current_value = val;
        } else {
            // No discriminant - assign the next sequential value
            current_value += 1;
            variant.discriminant = Some((Token![=](variant.span()), parse_quote!(#current_value)));
        }
    }

    quote! {
        #[soroban_sdk::contracterror]
        #[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
        #[repr(u32)]
        #data_enum
    }
}

/// Parses a discriminant value from a variant, returning the u32 value if valid.
/// Panics if the discriminant is not a valid integer literal.
fn parse_discriminant_value(disc: &syn::Expr) -> u32 {
    if let syn::Expr::Lit(ExprLit { lit: Lit::Int(lit_int), .. }) = disc {
        lit_int.base10_parse().expect("Error enum discriminant must be a valid u32 integer")
    } else {
        panic!("Error enum discriminant must be an integer literal")
    }
}
