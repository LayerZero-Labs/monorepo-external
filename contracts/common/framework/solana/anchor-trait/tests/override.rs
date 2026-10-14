#[cfg(test)]
mod tests {
    use anchor_trait::{InstructionOverrides, InstructionSet, InstructionSpec, OverrideConfig};
    use quote::ToTokens;

    // -----------------------------------------------------------------------
    // Test fixtures
    // -----------------------------------------------------------------------
    //
    // NOTE: This file intentionally does NOT use tests/common/mod.rs.
    // Override collection tests use a minimal TestIx (3 variants, no Token,
    // unimplemented spec) to prove that collect() works without needing
    // real InstructionSpec values. Sharing common's 4-variant TestIx would
    // obscure that property and add unnecessary coupling.

    /// Minimal instruction set for testing. Three variants covering:
    /// - SetPeer: a typical mutable instruction (has default impl in real usage)
    /// - GetPeer: a typical view instruction (has default impl in real usage)
    /// - LzReceive: a required instruction (no default impl in real usage)
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
    enum TestIx {
        SetPeer,
        GetPeer,
        LzReceive,
    }

    impl InstructionSet for TestIx {
        type Ctx = ();

        fn all() -> &'static [Self] {
            &[Self::SetPeer, Self::GetPeer, Self::LzReceive]
        }

        fn from_ident(ident: &syn::Ident) -> Option<Self> {
            match ident.to_string().as_str() {
                "set_peer" => Some(Self::SetPeer),
                "get_peer" => Some(Self::GetPeer),
                "lz_receive" => Some(Self::LzReceive),
                _ => None,
            }
        }

        fn canonical_name(&self) -> &'static str {
            match self {
                Self::SetPeer => "set_peer",
                Self::GetPeer => "get_peer",
                Self::LzReceive => "lz_receive",
            }
        }

        fn spec(self, _ctx: &()) -> InstructionSpec<()> {
            unimplemented!("TestIx::spec() is not used in override collection tests")
        }
    }

    const TEST_CONFIG: OverrideConfig =
        OverrideConfig { attr_name: "test_instruction", domain: "Test" };

    /// Helper: assert collect() succeeds and return the overrides.
    fn collect_ok(module: &syn::ItemMod) -> InstructionOverrides<TestIx> {
        InstructionOverrides::<TestIx>::collect(module, TEST_CONFIG)
            .expect("collect() should succeed")
    }

    /// Helper: assert collect() fails and return the error message.
    fn collect_err(module: &syn::ItemMod) -> String {
        match InstructionOverrides::<TestIx>::collect(module, TEST_CONFIG) {
            Err(e) => e.to_string(),
            Ok(_) => panic!("collect() should have failed but succeeded"),
        }
    }

    // -----------------------------------------------------------------------
    // Tests — override collection (happy path)
    // -----------------------------------------------------------------------

    #[test]
    fn empty_module_returns_no_overrides() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {}
        };
        let overrides = collect_ok(&module);
        assert!(overrides.get(TestIx::SetPeer).is_none());
        assert!(overrides.get(TestIx::GetPeer).is_none());
        assert!(overrides.get(TestIx::LzReceive).is_none());
    }

    #[test]
    fn non_handler_functions_are_ignored() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                fn some_helper() -> u64 { 42 }
                fn another_helper(x: u32) -> u32 { x + 1 }
            }
        };
        let overrides = collect_ok(&module);
        assert!(overrides.get(TestIx::SetPeer).is_none());
        assert!(overrides.get(TestIx::GetPeer).is_none());
        assert!(overrides.get(TestIx::LzReceive).is_none());
    }

    #[test]
    fn single_handler_override_detected() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn set_peer(ctx: &mut Context<MyAccounts>, params: &SetPeerParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let overrides = collect_ok(&module);

        let meta = overrides.get(TestIx::SetPeer).expect("SetPeer override should exist");
        assert!(
            meta.context_type.to_token_stream().to_string().contains("MyAccounts"),
            "context_type should contain MyAccounts"
        );
        assert_eq!(meta.wrapper_mod.to_string(), "__test_instruction__set_peer_handler");
        assert!(overrides.get(TestIx::GetPeer).is_none());
        assert!(overrides.get(TestIx::LzReceive).is_none());
    }

    #[test]
    fn qualified_attribute_path_recognized_as_override() {
        // A qualified attribute path like `#[crate::test_instruction]` should still
        // register as an override. `Path::is_ident` is strict-1-segment and would
        // silently miss this, leaving the function as a bare item and emitting the
        // default entrypoint instead.
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[crate::test_instruction]
                pub fn set_peer(ctx: &mut Context<MyAccounts>, params: &SetPeerParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let overrides = collect_ok(&module);

        assert!(
            overrides.get(TestIx::SetPeer).is_some(),
            "qualified #[crate::test_instruction] should register as a SetPeer override"
        );
    }

    #[test]
    fn multiple_unique_overrides() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn set_peer(ctx: &mut Context<PeerAccounts>, params: &SetPeerParams) -> Result<()> {
                    Ok(())
                }

                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<ReceiveAccounts>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let overrides = collect_ok(&module);

        let peer = overrides.get(TestIx::SetPeer).expect("SetPeer should exist");
        assert!(
            peer.context_type.to_token_stream().to_string().contains("PeerAccounts"),
            "context_type should contain PeerAccounts"
        );

        let recv = overrides.get(TestIx::LzReceive).expect("LzReceive should exist");
        assert!(
            recv.context_type.to_token_stream().to_string().contains("ReceiveAccounts"),
            "context_type should contain ReceiveAccounts"
        );

        assert!(overrides.get(TestIx::GetPeer).is_none());
    }

    #[test]
    fn handler_with_lifetime_generics() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn lz_receive<'info>(
                    ctx: &mut Context<'_, '_, '_, 'info, MyReceiveAccounts<'info>>,
                    params: &LzReceiveParams,
                ) -> Result<()> {
                    Ok(())
                }
            }
        };
        let overrides = collect_ok(&module);
        let meta = overrides.get(TestIx::LzReceive).expect("LzReceive should exist");

        let full_ctx = meta.context_type.to_token_stream().to_string();
        assert!(full_ctx.contains("Context"), "context_type should contain Context: {full_ctx}");
        assert!(
            full_ctx.contains("'_"),
            "context_type should preserve anonymous lifetimes: {full_ctx}"
        );
        assert!(
            full_ctx.contains("'info"),
            "context_type should preserve named lifetimes: {full_ctx}"
        );

        let generics = meta.fn_generics.to_token_stream().to_string();
        assert!(generics.contains("'info"), "fn_generics should contain 'info: {generics}");
    }

    #[test]
    fn filtered_items_removes_overridden_handlers() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn set_peer(ctx: &mut Context<MyAccounts>, params: &SetPeerParams) -> Result<()> {
                    Ok(())
                }

                pub fn helper_function() -> u64 {
                    42
                }

                struct MyState {
                    value: u64,
                }
            }
        };
        let overrides = collect_ok(&module);
        let filtered = overrides.filtered_items(&module).to_string();

        assert!(!filtered.contains("set_peer"), "overridden handler should be filtered out");
        assert!(filtered.contains("helper_function"), "regular fn should be kept");
        assert!(filtered.contains("MyState"), "struct should be kept");
    }

    // -----------------------------------------------------------------------
    // Tests — wrapper module generation
    // -----------------------------------------------------------------------

    #[test]
    fn wrapper_defs_contain_relocated_handler() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn get_peer(ctx: &Context<GetPeerAccounts>, params: &GetPeerParams) -> Result<[u8; 32]> {
                    Ok([0u8; 32])
                }
            }
        };
        let overrides = collect_ok(&module);

        // Parse wrapper_defs as a file so we can make structural AST assertions
        // instead of fragile string checks.
        let wrapper_file: syn::File =
            syn::parse2(overrides.wrapper_defs.clone()).expect("wrapper_defs should parse as file");

        let wrapper_mod = wrapper_file
            .items
            .iter()
            .find_map(|item| match item {
                syn::Item::Mod(m) if m.ident == "__test_instruction__get_peer_handler" => Some(m),
                _ => None,
            })
            .expect("wrapper module __test_instruction__get_peer_handler should exist");

        let wrapper_items = &wrapper_mod.content.as_ref().expect("wrapper should have body").1;

        let has_handler_fn = wrapper_items
            .iter()
            .any(|item| matches!(item, syn::Item::Fn(f) if f.sig.ident == "get_peer"));
        assert!(has_handler_fn, "handler fn `get_peer` should be inside wrapper module");

        let handler_fn = wrapper_items
            .iter()
            .find_map(|item| match item {
                syn::Item::Fn(f) if f.sig.ident == "get_peer" => Some(f),
                _ => None,
            })
            .unwrap();
        let has_override_attr =
            handler_fn.attrs.iter().any(|a| a.path().is_ident("test_instruction"));
        assert!(!has_override_attr, "override attr should be stripped in wrapper");

        let has_use_super = wrapper_items.iter().any(|item| {
            matches!(item, syn::Item::Use(u) if u.to_token_stream().to_string().contains("super :: *"))
        });
        assert!(has_use_super, "wrapper should have `use super::*`");
    }

    // -----------------------------------------------------------------------
    // Tests — error cases
    // -----------------------------------------------------------------------

    #[test]
    fn error_unknown_instruction_name() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn nonexistent(ctx: Context<Foo>) -> Result<()> {
                    Ok(())
                }
            }
        };
        let err = collect_err(&module);
        assert!(err.contains("unsupported"), "error should mention unsupported: {err}");
        assert!(err.contains("nonexistent"), "error should mention the bad name: {err}");
    }

    #[test]
    fn error_attribute_with_arguments_rejected() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction(set_peer)]
                pub fn set_peer(ctx: Context<Foo>) -> Result<()> {
                    Ok(())
                }
            }
        };
        let err = collect_err(&module);
        assert!(
            err.contains("does not accept arguments"),
            "error should mention no arguments allowed: {err}"
        );
    }

    #[test]
    fn error_handler_missing_context_param() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn set_peer() -> Result<()> {
                    Ok(())
                }
            }
        };
        let err = collect_err(&module);
        assert!(err.contains("Context"), "error should mention Context<T>: {err}");
    }

    #[test]
    fn error_handler_wrong_first_param_type() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn set_peer(x: u64) -> Result<()> {
                    Ok(())
                }
            }
        };
        let err = collect_err(&module);
        assert!(err.contains("Context"), "error should mention Context<T>: {err}");
    }

    #[test]
    fn error_handler_reference_to_non_context_type() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn set_peer(ctx: &SomethingElse) -> Result<()> {
                    Ok(())
                }
            }
        };
        let err = collect_err(&module);
        assert!(err.contains("Context"), "error should mention Context<T>: {err}");
    }

    #[test]
    fn error_bare_function_name_collision() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                pub fn set_peer(ctx: Context<Foo>) -> Result<()> {
                    Ok(())
                }
            }
        };
        let err = collect_err(&module);
        assert!(err.contains("conflicts"), "error should mention conflict: {err}");
        assert!(err.contains("set_peer"), "error should mention the function name: {err}");
    }

    #[test]
    fn error_duplicate_attribute_on_single_function() {
        // Two `#[test_instruction]` attrs on the same function — caught by `at_most_one()`.
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                #[test_instruction]
                pub fn set_peer(ctx: Context<Foo>) -> Result<()> {
                    Ok(())
                }
            }
        };
        let err = collect_err(&module);
        assert!(err.contains("duplicate"), "error should mention duplicate: {err}");
    }

    #[test]
    fn error_two_handlers_overriding_same_instruction() {
        // Two separate functions both named `set_peer` — the second hits
        // `collected.handlers.contains_key(&target)`, a distinct path from
        // the same-function duplicate-attr check above.
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn set_peer(ctx: &mut Context<AccountsA>, params: &SetPeerParams) -> Result<()> {
                    Ok(())
                }

                #[test_instruction]
                pub fn set_peer(ctx: &mut Context<AccountsB>, params: &SetPeerParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let err = collect_err(&module);
        assert!(err.contains("duplicate"), "error should mention duplicate: {err}");
        assert!(err.contains("set_peer"), "error should mention the instruction name: {err}");
    }

    // -----------------------------------------------------------------------
    // Tests — boundary conditions
    // -----------------------------------------------------------------------

    #[test]
    fn bodiless_module_returns_no_overrides() {
        // `mod foo;` (no body) — collect should return empty, not panic.
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program;
        };
        let overrides = collect_ok(&module);
        assert!(overrides.get(TestIx::SetPeer).is_none());
        assert!(overrides.get(TestIx::GetPeer).is_none());
        assert!(overrides.get(TestIx::LzReceive).is_none());
    }

    #[test]
    fn filtered_items_on_bodiless_module_returns_empty() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program;
        };
        let overrides = collect_ok(&module);
        let filtered = overrides.filtered_items(&module).to_string();
        assert!(
            filtered.is_empty(),
            "filtered_items on bodiless module should be empty: {filtered}"
        );
    }

    #[test]
    fn non_override_attrs_preserved_in_wrapper() {
        // A handler with both the override attr and a non-override attr —
        // the non-override attr should survive relocation into the wrapper module.
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[inline(always)]
                #[test_instruction]
                pub fn set_peer(ctx: &mut Context<MyAccounts>, params: &SetPeerParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let overrides = collect_ok(&module);
        let wrapper = overrides.wrapper_defs.to_string();

        assert!(
            !wrapper.contains("# [test_instruction"),
            "override attr should be stripped: {wrapper}"
        );
        assert!(
            wrapper.contains("inline"),
            "non-override attrs should be preserved in wrapper: {wrapper}"
        );
    }
}
