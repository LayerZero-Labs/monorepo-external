mod common;

#[cfg(test)]
mod tests {
    use super::common::*;
    use anchor_trait::{generate_instructions, Assembly, GeneratedInstructions};
    use proc_macro2::TokenStream;
    use quote::{format_ident, quote, ToTokens};

    // -----------------------------------------------------------------------
    // Helper
    // -----------------------------------------------------------------------

    /// Run the full pipeline (collect → generate → assemble) and parse the output.
    fn assemble_ok(
        module: &syn::ItemMod,
        prelude: TokenStream,
        extra_mod_attrs: TokenStream,
    ) -> syn::File {
        let overrides = collect_overrides(module);
        let instructions =
            generate_instructions(&TestCtx, &overrides).expect("generate should succeed");
        let assembly = Assembly {
            prelude,
            overrides,
            instructions,
            extra_mod_attrs,
            source_mod: module.clone(),
            extend_macro_name: None,
        };
        syn::parse2(assembly.assemble()).expect("assembly output should parse")
    }

    /// Find the program module in a parsed file (skips wrapper modules).
    fn find_program_mod(file: &syn::File) -> Option<(usize, &syn::ItemMod)> {
        file.items.iter().enumerate().find_map(|(i, item)| match item {
            syn::Item::Mod(m) if !m.ident.to_string().starts_with("__") => Some((i, m)),
            _ => None,
        })
    }

    /// Extract items from inside a module's body.
    fn mod_items(m: &syn::ItemMod) -> &Vec<syn::Item> {
        &m.content.as_ref().expect("module should have a body").1
    }

    /// A module with only the required lz_receive override.
    fn module_with_required_only() -> syn::ItemMod {
        syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        }
    }

    /// A module with a full override on set_peer + required lz_receive + non-handler items.
    fn module_with_override_and_extras() -> syn::ItemMod {
        syn::parse_quote! {
            mod my_program {
                #[test_instruction]
                pub fn set_peer(ctx: &mut Context<MyCustomAccounts>, params: &SetPeerParams) -> Result<()> {
                    Ok(())
                }

                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }

                pub fn helper_function() -> u64 {
                    42
                }

                struct MyState {
                    value: u64,
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Tests — output structure and ordering
    // -----------------------------------------------------------------------

    #[test]
    fn prelude_emitted_before_module() {
        let module = module_with_required_only();
        let file = assemble_ok(&module, quote! { struct PreludeMarker; }, quote! {});

        let prelude_pos = file
            .items
            .iter()
            .position(|item| matches!(item, syn::Item::Struct(s) if s.ident == "PreludeMarker"))
            .expect("prelude marker should exist");
        let (mod_pos, _) = find_program_mod(&file).expect("module should exist");

        assert!(
            prelude_pos < mod_pos,
            "prelude (pos {prelude_pos}) should come before module (pos {mod_pos})"
        );
    }

    #[test]
    fn wrappers_inside_module_and_default_impls_outside() {
        let module = module_with_override_and_extras();
        let file = assemble_ok(&module, quote! {}, quote! {});
        let (mod_pos, m) = find_program_mod(&file).expect("module should exist");

        // Wrapper modules are placed inside the program module so override handlers
        // can reach nested same-module helpers (e.g. `mod utils { ... }`).
        let inner = mod_items(m);
        let has_wrapper_inside = inner.iter().any(|item| {
            matches!(item, syn::Item::Mod(m) if m.ident.to_string().contains("__test_instruction__"))
        });
        assert!(has_wrapper_inside, "wrapper defs should live inside the program module");

        // Wrapper modules must NOT appear at outer scope.
        let has_wrapper_outside = file.items.iter().any(|item| {
            matches!(item, syn::Item::Mod(m) if m.ident.to_string().contains("__test_instruction__"))
        });
        assert!(!has_wrapper_outside, "wrapper defs should not appear outside the program module");

        // Default structs are always emitted for provided instructions, even when overridden.
        let has_default_impl_outside = file.items[..mod_pos].iter().any(|item| {
            matches!(item, syn::Item::Struct(s) if s.ident == "StdGetPeer" || s.ident == "StdToken" || s.ident == "StdSetPeer")
        });
        assert!(has_default_impl_outside, "default impls should be outside the module");
    }

    #[test]
    fn extra_mod_attrs_applied_to_module() {
        let module = module_with_required_only();
        let file = assemble_ok(&module, quote! {}, quote! {});
        let (_, m) = find_program_mod(&file).expect("module should exist");

        let has_program_attr = m
            .attrs
            .iter()
            .any(|attr| attr.path().segments.last().is_some_and(|seg| seg.ident == "program"));
        assert!(has_program_attr, "module should have #[program] attribute");
    }

    #[test]
    fn original_mod_attrs_preserved() {
        let module: syn::ItemMod = syn::parse_quote! {
            #[some_custom_attr]
            mod my_program {
                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let file = assemble_ok(&module, quote! {}, quote! {});
        let (_, m) = find_program_mod(&file).expect("module should exist");

        let has_custom_attr = m.attrs.iter().any(|attr| {
            attr.path().segments.last().is_some_and(|seg| seg.ident == "some_custom_attr")
        });
        assert!(has_custom_attr, "original module attributes should be preserved");
    }

    #[test]
    fn inner_attrs_routed_into_module_body() {
        // Inner attributes (#![...]) and inner doc comments (//!) on the source module
        // must end up inside the generated mod's body, not outside, otherwise rustc
        // rejects them with "an inner attribute is not permitted in this context".
        let module: syn::ItemMod = syn::parse_quote! {
            mod my_program {
                #![deny(clippy::arithmetic_side_effects)]
                #![allow(unused_variables)]
                //! Module-level doc comment.

                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let file = assemble_ok(&module, quote! {}, quote! {});
        let (_, m) = find_program_mod(&file).expect("module should exist");

        let inner_attrs: Vec<_> =
            m.attrs.iter().filter(|a| matches!(a.style, syn::AttrStyle::Inner(_))).collect();

        let has_deny = inner_attrs
            .iter()
            .any(|a| a.path().segments.last().is_some_and(|seg| seg.ident == "deny"));
        let has_allow = inner_attrs
            .iter()
            .any(|a| a.path().segments.last().is_some_and(|seg| seg.ident == "allow"));
        let has_inner_doc = inner_attrs
            .iter()
            .any(|a| a.path().segments.last().is_some_and(|seg| seg.ident == "doc"));

        assert!(
            has_deny,
            "#![deny(...)] should be preserved as an inner attr on the generated mod"
        );
        assert!(
            has_allow,
            "#![allow(...)] should be preserved as an inner attr on the generated mod"
        );
        assert!(
            has_inner_doc,
            "//! doc comment should be preserved as an inner attr on the generated mod"
        );

        // Sanity: no inner-style attribute should appear *before* the generated mod —
        // that would be exactly the position rustc rejects.
        let rendered = quote!(#file).to_string();
        let mod_token = format!("mod {}", m.ident);
        let prefix = rendered
            .split(&mod_token)
            .next()
            .expect("rendered output should contain the module");
        assert!(
            !prefix.contains("# ! ["),
            "no inner-style attribute (#![...]) should appear before the generated mod;\n\
             prefix was:\n{prefix}"
        );
    }

    #[test]
    fn qualified_program_attr_is_deduplicated() {
        // A previously-expanded macro may have placed a qualified #[program] on the
        // source module (e.g. `#[anchor_lang::prelude::program]`). Assembly always
        // re-emits a canonical `#[program]`, so the qualified form must be filtered
        // out — otherwise the generated module carries two `#[program]` attributes
        // and Anchor's program macro would expand twice.
        let module: syn::ItemMod = syn::parse_quote! {
            #[anchor_lang::prelude::program]
            mod my_program {
                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let file = assemble_ok(&module, quote! {}, quote! {});
        let (_, m) = find_program_mod(&file).expect("module should exist");

        let program_attr_count = m
            .attrs
            .iter()
            .filter(|a| a.path().segments.last().is_some_and(|s| s.ident == "program"))
            .count();
        assert_eq!(
            program_attr_count, 1,
            "exactly one #[program] attr should remain on the generated mod"
        );
    }

    #[test]
    fn outer_and_inner_attrs_partitioned_correctly() {
        let module: syn::ItemMod = syn::parse_quote! {
            #[some_outer_attr]
            mod my_program {
                #![deny(clippy::arithmetic_side_effects)]

                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let file = assemble_ok(&module, quote! {}, quote! {});
        let (_, m) = find_program_mod(&file).expect("module should exist");

        let has_outer = m.attrs.iter().any(|a| {
            matches!(a.style, syn::AttrStyle::Outer)
                && a.path().segments.last().is_some_and(|seg| seg.ident == "some_outer_attr")
        });
        let has_inner_deny = m.attrs.iter().any(|a| {
            matches!(a.style, syn::AttrStyle::Inner(_))
                && a.path().segments.last().is_some_and(|seg| seg.ident == "deny")
        });

        assert!(has_outer, "outer attribute should be preserved on the generated mod");
        assert!(has_inner_deny, "inner attribute should be preserved on the generated mod");
    }

    #[test]
    fn filtered_items_inside_module() {
        let module = module_with_override_and_extras();
        let file = assemble_ok(&module, quote! {}, quote! {});
        let (_, m) = find_program_mod(&file).expect("module should exist");
        let items = mod_items(m);

        // The override handler is relocated to a wrapper module, so it should not appear
        // as a function definition inside the program module. The name still appears in
        // dispatch calls inside entrypoints, so we match on function definitions specifically.
        let has_override_fn = items.iter().any(|item| {
            matches!(item, syn::Item::Fn(f) if f.sig.ident == "set_peer"
                && f.block.to_token_stream().to_string().contains("MyCustomAccounts"))
        });
        assert!(
            !has_override_fn,
            "overridden handler with custom body should be filtered out of module body"
        );

        let has_helper = items
            .iter()
            .any(|item| matches!(item, syn::Item::Fn(f) if f.sig.ident == "helper_function"));
        assert!(has_helper, "helper_function should be inside module");

        let has_struct = items
            .iter()
            .any(|item| matches!(item, syn::Item::Struct(s) if s.ident == "MyState"));
        assert!(has_struct, "MyState struct should be inside module");
    }

    #[test]
    fn entrypoints_inside_module() {
        let module = module_with_required_only();
        let file = assemble_ok(&module, quote! {}, quote! {});
        let (_, m) = find_program_mod(&file).expect("module should exist");
        let items = mod_items(m);

        let fns: Vec<_> = items
            .iter()
            .filter_map(|item| match item {
                syn::Item::Fn(f) => Some(f.sig.ident.to_string()),
                _ => None,
            })
            .collect();

        assert!(
            fns.contains(&"set_peer".to_string()),
            "set_peer entrypoint should be inside module"
        );
        assert!(
            fns.contains(&"get_peer".to_string()),
            "get_peer entrypoint should be inside module"
        );
        assert!(
            fns.contains(&"lz_receive".to_string()),
            "lz_receive entrypoint should be inside module"
        );
        assert!(fns.contains(&"token".to_string()), "token entrypoint should be inside module");
    }

    #[test]
    fn wrapper_defs_contain_override_handlers() {
        let module = module_with_override_and_extras();
        let file = assemble_ok(&module, quote! {}, quote! {});
        let (_, program_mod) = find_program_mod(&file).expect("module should exist");

        let wrapper = mod_items(program_mod)
            .iter()
            .find_map(|item| match item {
                syn::Item::Mod(m)
                    if m.ident.to_string().contains("__test_instruction__set_peer") =>
                {
                    Some(m)
                },
                _ => None,
            })
            .expect("wrapper module for set_peer should exist inside the program module");

        let wrapper_items = mod_items(wrapper);
        let has_handler = wrapper_items
            .iter()
            .any(|item| matches!(item, syn::Item::Fn(f) if f.sig.ident == "set_peer"));
        assert!(has_handler, "wrapper should contain the relocated override handler");
    }

    #[test]
    fn module_visibility_preserved() {
        let module: syn::ItemMod = syn::parse_quote! {
            pub mod my_program {
                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let file = assemble_ok(&module, quote! {}, quote! {});
        let (_, m) = find_program_mod(&file).expect("module should exist");

        assert!(
            matches!(m.vis, syn::Visibility::Public(_)),
            "pub visibility should be preserved on module"
        );
    }

    #[test]
    fn use_super_star_injected_into_module() {
        let module = module_with_required_only();
        let file = assemble_ok(&module, quote! {}, quote! {});
        let (_, m) = find_program_mod(&file).expect("module should exist");
        let items = mod_items(m);

        let has_use_super = items.iter().any(|item| {
            matches!(item, syn::Item::Use(u) if u.to_token_stream().to_string().contains("super :: *"))
        });
        assert!(has_use_super, "module should contain `use super::*`");
    }

    // -----------------------------------------------------------------------
    // Tests — extend macro emission
    // -----------------------------------------------------------------------

    #[test]
    fn extend_macro_emitted_when_configured() {
        let module = module_with_required_only();
        let overrides = collect_overrides(&module);
        let instructions =
            generate_instructions(&TestCtx, &overrides).expect("generate should succeed");
        let assembly = Assembly {
            prelude: quote! {},
            overrides,
            instructions,
            extra_mod_attrs: quote! {},
            source_mod: module.clone(),
            extend_macro_name: Some(format_ident!("test_extend_accounts")),
        };
        let file: syn::File =
            syn::parse2(assembly.assemble()).expect("assembly output should parse");

        let has_macro = file.items.iter().any(|item| {
            matches!(item, syn::Item::Macro(m) if m.ident.as_ref().is_some_and(|id| id == "test_extend_accounts"))
        });
        assert!(has_macro, "should emit macro_rules! test_extend_accounts");
    }

    #[test]
    fn program_attr_already_present_is_not_duplicated() {
        // If the source module already carries `#[program]` (from a prior macro pass),
        // assembly must strip it before re-emitting it as the innermost attribute.
        let module: syn::ItemMod = syn::parse_quote! {
            #[program]
            mod my_program {
                #[test_instruction]
                pub fn lz_receive(ctx: &mut Context<MyReceive>, params: &LzReceiveParams) -> Result<()> {
                    Ok(())
                }
            }
        };
        let file = assemble_ok(&module, quote! {}, quote! {});
        let (_, m) = find_program_mod(&file).expect("module should exist");

        let program_count = m.attrs.iter().filter(|a| a.path().is_ident("program")).count();
        assert_eq!(
            program_count, 1,
            "#[program] should appear exactly once, not duplicated: {program_count}"
        );
    }

    #[test]
    fn extend_macro_omitted_when_extend_rules_empty() {
        // `extend_macro_name = Some(name)` but no extend rules → no macro_rules! emitted.
        let module = module_with_required_only();
        let overrides = collect_overrides(&module);
        let assembly = Assembly {
            prelude: quote! {},
            overrides,
            instructions: GeneratedInstructions::default(),
            extra_mod_attrs: quote! {},
            source_mod: module.clone(),
            extend_macro_name: Some(format_ident!("test_extend_accounts")),
        };
        let file: syn::File = syn::parse2(assembly.assemble()).expect("should parse");

        let has_any_macro = file.items.iter().any(|item| matches!(item, syn::Item::Macro(_)));
        assert!(
            !has_any_macro,
            "no macro_rules! should be emitted when extend_rules is empty, even when extend_macro_name is Some"
        );
    }

    #[test]
    fn extend_macro_omitted_when_none() {
        let module = module_with_required_only();
        let file = assemble_ok(&module, quote! {}, quote! {});

        let has_any_macro = file.items.iter().any(|item| matches!(item, syn::Item::Macro(_)));
        assert!(!has_any_macro, "no macro_rules! should be emitted when extend_macro_name is None");
    }

    #[test]
    fn extend_macro_positioned_before_program_module() {
        let module = module_with_required_only();
        let overrides = collect_overrides(&module);
        let instructions =
            generate_instructions(&TestCtx, &overrides).expect("generate should succeed");
        let assembly = Assembly {
            prelude: quote! {},
            overrides,
            instructions,
            extra_mod_attrs: quote! {},
            source_mod: module.clone(),
            extend_macro_name: Some(format_ident!("test_extend_accounts")),
        };
        let file: syn::File =
            syn::parse2(assembly.assemble()).expect("assembly output should parse");

        let macro_pos = file
            .items
            .iter()
            .position(|item| matches!(item, syn::Item::Macro(_)))
            .expect("extend macro should exist");
        let (mod_pos, _) = find_program_mod(&file).expect("module should exist");
        assert!(
            macro_pos < mod_pos,
            "extend macro (pos {macro_pos}) should come before program module (pos {mod_pos})"
        );
    }

    #[test]
    fn extend_macro_contains_rules_for_each_provided_instruction() {
        let module = module_with_required_only();
        let overrides = collect_overrides(&module);
        let instructions =
            generate_instructions(&TestCtx, &overrides).expect("generate should succeed");
        let assembly = Assembly {
            prelude: quote! {},
            overrides,
            instructions,
            extra_mod_attrs: quote! {},
            source_mod: module.clone(),
            extend_macro_name: Some(format_ident!("test_extend_accounts")),
        };
        let output = assembly.assemble().to_string();

        // Check for the rule-arm matcher pattern `(set_peer ,` rather than just the bare name.
        // The bare name also appears in entrypoints and wrapper modules, making it a trivially
        // weak check. The `(name ,` prefix is unique to the macro_rules! arm head.
        assert!(output.contains("(set_peer ,"), "macro should contain set_peer rule arm: {output}");
        assert!(output.contains("(get_peer ,"), "macro should contain get_peer rule arm: {output}");
        assert!(output.contains("(token ,"), "macro should contain token rule arm: {output}");
    }

    // -----------------------------------------------------------------------
    // Tests — full integration
    // -----------------------------------------------------------------------

    #[test]
    fn full_assembly_integration() {
        let module = module_with_override_and_extras();
        let file = assemble_ok(&module, quote! { struct PreludeMarker; }, quote! {});

        // Verify outer-scope ordering: prelude → default impls → module
        // (wrapper modules now live inside the program module — see assertion below).
        let prelude_pos = file
            .items
            .iter()
            .position(|item| matches!(item, syn::Item::Struct(s) if s.ident == "PreludeMarker"))
            .expect("prelude should exist");

        let context_pos = file
            .items
            .iter()
            .position(|item| {
                matches!(item, syn::Item::Struct(s) if s.ident == "StdGetPeer" || s.ident == "StdToken")
            })
            .expect("default impl struct should exist");

        let (mod_pos, m) = find_program_mod(&file).expect("module should exist");

        assert!(prelude_pos < context_pos, "prelude before default impls");
        assert!(context_pos < mod_pos, "default impls before module");

        // Wrapper modules must sit inside the program module, not at outer scope.
        let has_wrapper_outside = file.items.iter().any(|item| {
            matches!(item, syn::Item::Mod(m) if m.ident.to_string().contains("__test_instruction__"))
        });
        assert!(!has_wrapper_outside, "wrapper modules should not appear at outer scope");

        let items = mod_items(m);
        let has_wrapper_inside = items.iter().any(|item| {
            matches!(item, syn::Item::Mod(m) if m.ident.to_string().contains("__test_instruction__"))
        });
        assert!(has_wrapper_inside, "wrapper modules should sit inside the program module");

        let has_program = m
            .attrs
            .iter()
            .any(|attr| attr.path().segments.last().is_some_and(|seg| seg.ident == "program"));
        assert!(has_program, "module should have #[program]");

        let fn_names: Vec<_> = items
            .iter()
            .filter_map(|item| match item {
                syn::Item::Fn(f) => Some(f.sig.ident.to_string()),
                _ => None,
            })
            .collect();
        assert!(fn_names.contains(&"set_peer".to_string()), "set_peer inside module");
        assert!(fn_names.contains(&"token".to_string()), "token inside module");
    }
}
