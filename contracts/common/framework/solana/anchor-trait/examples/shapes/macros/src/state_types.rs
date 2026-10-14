use proc_macro2::TokenStream;
use quote::quote;

pub fn generate_shape_state() -> TokenStream {
    quote! {
        #[account]
        #[derive(InitSpace)]
        pub struct ShapeState {
            pub width: u64,
            pub height: u64,
            pub bump: u8,
        }
    }
}
