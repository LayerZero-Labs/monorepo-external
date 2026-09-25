use quote::quote;

// ============================================
// Snapshot Tests: OApp Code Generation
// ============================================

#[test]
fn snapshot_generate_oapp() {
    let struct_input = quote! {
        pub struct MyOApp;
    };

    let all_defaults = {
        let result = crate::generators::generate_oapp(quote! {}, struct_input.clone());
        prettyplease::unparse(&syn::parse2::<syn::File>(result).expect("failed to parse generated code"))
    };

    let custom_core_only = {
        let result = crate::generators::generate_oapp(quote! { custom = [core] }, struct_input.clone());
        prettyplease::unparse(&syn::parse2::<syn::File>(result).expect("failed to parse generated code"))
    };

    let custom_sender_only = {
        let result = crate::generators::generate_oapp(quote! { custom = [sender] }, struct_input.clone());
        prettyplease::unparse(&syn::parse2::<syn::File>(result).expect("failed to parse generated code"))
    };

    let custom_receiver_only = {
        let result = crate::generators::generate_oapp(quote! { custom = [receiver] }, struct_input.clone());
        prettyplease::unparse(&syn::parse2::<syn::File>(result).expect("failed to parse generated code"))
    };

    let custom_options_type3_only = {
        let result = crate::generators::generate_oapp(quote! { custom = [options_type3] }, struct_input.clone());
        prettyplease::unparse(&syn::parse2::<syn::File>(result).expect("failed to parse generated code"))
    };

    let custom_all = {
        let result = crate::generators::generate_oapp(
            quote! { custom = [core, sender, receiver, options_type3] },
            struct_input.clone(),
        );
        prettyplease::unparse(&syn::parse2::<syn::File>(result).expect("failed to parse generated code"))
    };

    let preserves_struct_attributes_and_fields = {
        let fancy_input = quote! {
            #[derive(Clone, Debug)]
            pub struct FancyOApp {
                pub x: u32,
            }
        };
        let result = crate::generators::generate_oapp(quote! {}, fancy_input);
        prettyplease::unparse(&syn::parse2::<syn::File>(result).expect("failed to parse generated code"))
    };

    let combined = format!(
        "// === Default (no custom impls) ===\n\n{}\n\n\
// === custom = [core] ===\n\n{}\n\n\
// === custom = [sender] ===\n\n{}\n\n\
// === custom = [receiver] ===\n\n{}\n\n\
// === custom = [options_type3] ===\n\n{}\n\n\
// === custom = [core, sender, receiver, options_type3] ===\n\n{}\n\n\
// === Struct attributes + fields are preserved ===\n\n{}",
        all_defaults,
        custom_core_only,
        custom_sender_only,
        custom_receiver_only,
        custom_options_type3_only,
        custom_all,
        preserves_struct_attributes_and_fields
    );
    insta::assert_snapshot!(combined);
}
