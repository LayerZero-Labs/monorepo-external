mod common;

#[cfg(test)]
mod tests {
    use super::common::*;
    use quote::{quote, ToTokens};

    // -----------------------------------------------------------------------
    // Tests — override level resolution
    // -----------------------------------------------------------------------

    #[test]
    fn default_level_emits_context_and_entrypoint() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let gen = generate_ok(&module);

        let structs = parse_structs(&gen.default_impls);
        assert!(find_struct(&structs, "StdSetPeer").is_some(), "should emit StdSetPeer");
        assert!(find_struct(&structs, "StdGetPeer").is_some(), "should emit StdGetPeer");
        assert!(find_struct(&structs, "StdToken").is_some(), "should emit StdToken");

        let fns = parse_fns(&gen.entrypoints);
        assert!(find_fn(&fns, "set_peer").is_some(), "should have set_peer entrypoint");
        assert!(find_fn(&fns, "get_peer").is_some(), "should have get_peer entrypoint");
        assert!(find_fn(&fns, "lz_receive").is_some(), "should have lz_receive entrypoint");
        assert!(find_fn(&fns, "token").is_some(), "should have token entrypoint");
    }

    #[test]
    fn default_mutable_passes_mut_ref() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let gen = generate_ok(&module);
        let fns = parse_fns(&gen.entrypoints);
        let set_peer = find_fn(&fns, "set_peer").expect("set_peer entrypoint should exist");

        // set_peer is mutable (is_view = false), default level → mut ctx: Context<StdSetPeer>
        let (is_mut, ctx_type) = first_param_context_type(set_peer);
        assert!(is_mut, "set_peer should have `mut ctx`");
        assert_eq!(ctx_type, "StdSetPeer", "should use default context type");

        // Default handler called by reference: StdSetPeer::apply(&mut ctx, &params)
        let body = set_peer.block.to_token_stream().to_string();
        assert!(
            body.contains("StdSetPeer :: apply (& mut ctx , & params)"),
            "mutable default should pass &mut ctx and &params to handler: {body}"
        );
    }

    #[test]
    fn default_view_passes_immutable_ref() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let gen = generate_ok(&module);
        let fns = parse_fns(&gen.entrypoints);
        let get_peer = find_fn(&fns, "get_peer").expect("get_peer entrypoint should exist");

        // get_peer is view (is_view = true), default level → ctx: Context<StdGetPeer>
        let (is_mut, ctx_type) = first_param_context_type(get_peer);
        assert!(!is_mut, "view default should use `ctx` (no mut)");
        assert_eq!(ctx_type, "StdGetPeer", "should use default context type");

        // Default handler called by immutable reference: StdGetPeer::apply(&ctx, &params)
        let body = get_peer.block.to_token_stream().to_string();
        assert!(
            body.contains("StdGetPeer :: apply (& ctx , & params)"),
            "view default should pass &ctx and &params to handler: {body}"
        );
    }

    #[test]
    fn override_with_default_context_emits_default() {
        // Override set_peer but reuse StdSetPeer context.
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn set_peer(ctx: &mut Context<StdSetPeer>, params: &SetPeerParams) -> Result<()> {
                    Ok(())
                }

                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let gen = generate_ok(&module);

        let structs = parse_structs(&gen.default_impls);
        assert!(
            find_struct(&structs, "StdSetPeer").is_some(),
            "override should still emit StdSetPeer context"
        );

        let fns = parse_fns(&gen.entrypoints);
        let set_peer = find_fn(&fns, "set_peer").expect("set_peer entrypoint should exist");
        let body = set_peer.block.to_token_stream().to_string();
        assert!(
            body.contains("__test_instruction__set_peer_handler :: set_peer"),
            "should dispatch to wrapper handler: {body}"
        );
    }

    #[test]
    fn override_with_custom_context_still_emits_default() {
        // Override set_peer with a custom context type (not StdSetPeer).
        // Default struct is always emitted for provided instructions, even when
        // the override handler uses a different context type.
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn set_peer(ctx: &mut Context<MyCustomAccounts>, params: &SetPeerParams) -> Result<()> {
                    Ok(())
                }

                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let gen = generate_ok(&module);

        let structs = parse_structs(&gen.default_impls);
        assert!(
            find_struct(&structs, "StdSetPeer").is_some(),
            "override should still emit StdSetPeer (always available)"
        );
        assert!(
            find_struct(&structs, "StdGetPeer").is_some(),
            "get_peer should still have default"
        );
        assert!(find_struct(&structs, "StdToken").is_some(), "token should still have default");

        let fns = parse_fns(&gen.entrypoints);
        let set_peer = find_fn(&fns, "set_peer").expect("set_peer entrypoint should exist");
        let (is_mut, ctx_type) = first_param_context_type(set_peer);
        assert!(is_mut, "set_peer should have `mut ctx`");
        assert_eq!(ctx_type, "MyCustomAccounts", "override should use custom context type");

        let body = set_peer.block.to_token_stream().to_string();
        assert!(
            body.contains("__test_instruction__set_peer_handler :: set_peer"),
            "should dispatch to wrapper handler: {body}"
        );
    }

    #[test]
    fn override_receives_params_by_ref() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn set_peer(ctx: &mut Context<MyAccounts>, params: &SetPeerParams) -> Result<()> {
                    Ok(())
                }

                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let gen = generate_ok(&module);
        let fns = parse_fns(&gen.entrypoints);
        let set_peer = find_fn(&fns, "set_peer").expect("set_peer entrypoint should exist");

        let body = set_peer.block.to_token_stream().to_string();
        assert!(
            body.contains("set_peer (& mut ctx , & params)"),
            "override should pass ctx by &mut and params by &: {body}"
        );
    }

    #[test]
    fn no_params_instruction_generates_parameterless_entrypoint() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let gen = generate_ok(&module);
        let fns = parse_fns(&gen.entrypoints);
        let token = find_fn(&fns, "token").expect("token entrypoint should exist");

        assert_eq!(token.sig.inputs.len(), 1, "no-params instruction should have only ctx");
        let (is_mut, ctx_type) = first_param_context_type(token);
        assert!(!is_mut, "token is a view — should not be mut");
        assert_eq!(ctx_type, "StdToken", "should use default context type");
    }

    // -----------------------------------------------------------------------
    // Tests — boundary conditions
    // -----------------------------------------------------------------------

    #[test]
    fn view_override_with_params_gets_immutable_ref() {
        // Override get_peer (view, has params) — entrypoint must have immutable ctx
        // and dispatch to wrapper with (&ctx, &params).
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn get_peer(ctx: &Context<MyGetPeerAccounts>, params: &GetPeerParams) -> Result<[u8; 32]> {
                    Ok([0u8; 32])
                }

                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let gen = generate_ok(&module);
        let fns = parse_fns(&gen.entrypoints);
        let get_peer = find_fn(&fns, "get_peer").expect("get_peer entrypoint should exist");

        let (is_mut, ctx_type) = first_param_context_type(get_peer);
        assert!(!is_mut, "view override should have immutable ctx");
        assert_eq!(ctx_type, "MyGetPeerAccounts", "should use override's context type");

        let body = get_peer.block.to_token_stream().to_string();
        assert!(
            body.contains("get_peer (& ctx , & params)"),
            "view override should pass ctx by & and params by &: {body}"
        );
    }

    #[test]
    fn override_no_params_receives_ctx_by_ref() {
        // Override token (no params, view) — entrypoint must dispatch with just `&ctx`.
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn token(ctx: &Context<MyTokenAccounts>) -> Result<Pubkey> {
                    Ok(Pubkey::default())
                }

                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let gen = generate_ok(&module);
        let fns = parse_fns(&gen.entrypoints);
        let token = find_fn(&fns, "token").expect("token entrypoint should exist");

        assert_eq!(token.sig.inputs.len(), 1, "no-params override should have only ctx");
        let body = token.block.to_token_stream().to_string();
        assert!(body.contains("token (& ctx)"), "no-params override should pass ctx by &: {body}");
    }

    #[test]
    fn return_type_from_spec_propagated_to_entrypoint() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let gen = generate_ok(&module);
        let fns = parse_fns(&gen.entrypoints);

        // Return types come from the spec, not the override handler.
        let get_peer = find_fn(&fns, "get_peer").expect("get_peer should exist");
        let ret = get_peer.sig.output.to_token_stream().to_string();
        assert!(ret.contains("[u8 ; 32]"), "get_peer return type should be [u8; 32]: {ret}");

        let token = find_fn(&fns, "token").expect("token should exist");
        let ret = token.sig.output.to_token_stream().to_string();
        assert!(ret.contains("Pubkey"), "token return type should be Pubkey: {ret}");

        let set_peer = find_fn(&fns, "set_peer").expect("set_peer should exist");
        let ret = set_peer.sig.output.to_token_stream().to_string();
        assert!(ret.contains("()"), "set_peer return type should be (): {ret}");
    }

    #[test]
    fn fn_generics_from_handler_propagated_to_entrypoint() {
        // Override with lifetime generics — entrypoint should carry them.
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn lz_receive<'info>(
                    ctx: &mut Context<'_, '_, '_, 'info, MyReceive<'info>>,
                    params: &LzReceiveParams,
                ) -> Result<()> {
                    Ok(())
                }
            }
        };
        let gen = generate_ok(&module);
        let fns = parse_fns(&gen.entrypoints);
        let lz_receive = find_fn(&fns, "lz_receive").expect("lz_receive should exist");

        let generics = lz_receive.sig.generics.to_token_stream().to_string();
        assert!(
            generics.contains("'info"),
            "entrypoint should carry handler's lifetime generics: {generics}"
        );
    }

    // -----------------------------------------------------------------------
    // Tests — extend rules
    // -----------------------------------------------------------------------

    #[test]
    fn extend_rules_generated_for_provided_instructions() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let gen = generate_ok(&module);

        let rules = gen.extend_rules.to_string();
        assert!(
            !rules.is_empty(),
            "extend_rules should be non-empty when provided instructions exist"
        );
        assert!(rules.contains("set_peer"), "should contain a rule for set_peer");
        assert!(rules.contains("get_peer"), "should contain a rule for get_peer");
        assert!(rules.contains("token"), "should contain a rule for token");
        assert!(
            !rules.contains("lz_receive"),
            "required instruction should NOT have an extend rule"
        );
    }

    #[test]
    fn extend_rule_contains_base_fields_and_extra_placeholder() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let gen = generate_ok(&module);

        let rules = gen.extend_rules.to_string();
        assert!(rules.contains("placeholder"), "extend rules should include base fields");
        assert!(
            rules.contains("extra"),
            "extend rules should include $($extra)* for appended accounts"
        );
    }

    #[test]
    fn extend_rule_preserves_struct_attributes() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let gen = generate_ok(&module);

        let rules = gen.extend_rules.to_string();
        // Compare against the tokenized form rather than a raw string to be precise.
        let expected = quote! { #[derive(Accounts)] }.to_string();
        assert!(
            rules.contains(&expected),
            "extend rules should preserve struct attributes `{expected}`: {rules}"
        );
    }

    #[test]
    fn extend_rule_handler_uses_context_self() {
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let gen = generate_ok(&module);

        let rules = gen.extend_rules.to_string();
        assert!(
            rules.contains("Context < Self >"),
            "extend rule handlers must use Context<Self> so they work for any extended struct name: {rules}"
        );
    }

    // -----------------------------------------------------------------------
    // Tests — signature validation errors
    // -----------------------------------------------------------------------

    #[test]
    fn error_required_instruction_missing_handler() {
        // lz_receive is required (no default) but not overridden.
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {}
        };
        let err = generate_err(&module);
        assert!(err.contains("lz_receive"), "should mention instruction name: {err}");
        assert!(err.contains("no default implementation"), "should explain why: {err}");
    }
}
