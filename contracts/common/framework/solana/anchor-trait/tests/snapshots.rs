mod common;

#[cfg(test)]
mod tests {
    use super::common::*;
    use anchor_trait::{generate_instructions, Assembly};
    use proc_macro2::TokenStream;
    use quote::quote;

    /// Run the full pipeline and return prettyplease-formatted output.
    fn assemble_formatted(
        module: &syn::ItemMod,
        prelude: TokenStream,
        extra_mod_attrs: TokenStream,
    ) -> String {
        assemble_formatted_with_extend(module, prelude, extra_mod_attrs, None)
    }

    fn assemble_formatted_with_extend(
        module: &syn::ItemMod,
        prelude: TokenStream,
        extra_mod_attrs: TokenStream,
        extend_macro_name: Option<proc_macro2::Ident>,
    ) -> String {
        let overrides = collect_overrides(module);
        let instructions =
            generate_instructions(&TestCtx, &overrides).expect("generate should succeed");
        let assembly = Assembly {
            prelude,
            overrides,
            instructions,
            extra_mod_attrs,
            source_mod: module.clone(),
            extend_macro_name,
        };
        let output = assembly.assemble();
        let file = syn::parse2::<syn::File>(output).expect("assembly output should parse");
        prettyplease::unparse(&file)
    }

    // -----------------------------------------------------------------------
    // Snapshot: all defaults (no overrides, only required lz_receive)
    // -----------------------------------------------------------------------

    #[test]
    fn snapshot_all_defaults() {
        let module: syn::ItemMod = syn::parse_quote! {
            pub mod my_program {
                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };

        let output = assemble_formatted(&module, quote! {}, quote! {});
        insta::assert_snapshot!(output);
    }

    // -----------------------------------------------------------------------
    // Snapshot: override reusing default accounts
    // -----------------------------------------------------------------------

    #[test]
    fn snapshot_handler_override() {
        let module: syn::ItemMod = syn::parse_quote! {
            pub mod my_program {
                #[test_instruction]
                pub fn set_peer(ctx: &mut Context<StdSetPeer>, params: &SetPeerParams) -> Result<()> {
                    msg!("custom set_peer logic");
                    Ok(())
                }

                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };

        let output = assemble_formatted(&module, quote! {}, quote! {});
        insta::assert_snapshot!(output);
    }

    // -----------------------------------------------------------------------
    // Snapshot: override with custom accounts
    // -----------------------------------------------------------------------

    #[test]
    fn snapshot_full_override() {
        let module: syn::ItemMod = syn::parse_quote! {
            pub mod my_program {
                #[test_instruction]
                pub fn set_peer(ctx: &mut Context<MyCustomAccounts>, params: &SetPeerParams) -> Result<()> {
                    msg!("fully custom set_peer");
                    Ok(())
                }

                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };

        let output = assemble_formatted(&module, quote! {}, quote! {});
        insta::assert_snapshot!(output);
    }

    // -----------------------------------------------------------------------
    // Snapshot: mixed (default + override in one program)
    // -----------------------------------------------------------------------

    #[test]
    fn snapshot_mixed_overrides() {
        let module: syn::ItemMod = syn::parse_quote! {
            pub mod my_program {
                // Override — custom logic, reusing default accounts
                #[test_instruction]
                pub fn set_peer(ctx: &mut Context<StdSetPeer>, params: &SetPeerParams) -> Result<()> {
                    msg!("handler override set_peer");
                    Ok(())
                }

                // Override — custom accounts + custom logic
                #[test_instruction]
                pub fn get_peer(ctx: &Context<MyCustomGetPeer>, params: &GetPeerParams) -> Result<[u8; 32]> {
                    Ok([0u8; 32])
                }

                // Required — must provide
                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }

                // Default — token left as-is (no override)

                // Non-handler items preserved
                pub fn helper() -> u64 { 42 }
                struct MyState { value: u64 }
            }
        };

        let output = assemble_formatted(&module, quote! { struct PreludeMarker; }, quote! {});
        insta::assert_snapshot!(output);
    }

    // -----------------------------------------------------------------------
    // Snapshot: extend macro emitted alongside defaults
    // -----------------------------------------------------------------------

    #[test]
    fn snapshot_with_extend_macro() {
        let module: syn::ItemMod = syn::parse_quote! {
            pub mod my_program {
                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };

        let output = assemble_formatted_with_extend(
            &module,
            quote! {},
            quote! {},
            Some(quote::format_ident!("test_extend_accounts")),
        );
        insta::assert_snapshot!(output);
    }
}
