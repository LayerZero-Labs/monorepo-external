use proc_macro2::TokenStream;
use quote::quote;
use syn::ItemMod;

pub fn expand(_attr: TokenStream, item: TokenStream) -> syn::Result<TokenStream> {
    let mut module = syn::parse2::<ItemMod>(item)?;

    if let Some((_, ref mut items)) = module.content {
        items.push(syn::parse_quote! {
            pub const SHAPES_AUDIT_ENABLED: bool = true;
        });
    }

    Ok(quote! { #module })
}
