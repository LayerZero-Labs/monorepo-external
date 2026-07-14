#![allow(unused_macros)]

pub(in crate::tests) fn assert_panics_contains<F>(case: &str, expected_substring: &str, f: F)
where
    F: FnOnce() + std::panic::UnwindSafe,
{
    let result = std::panic::catch_unwind(f);
    assert!(result.is_err(), "{case}: expected panic, but function returned normally");

    let payload = result.expect_err("checked above");
    let msg = if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        format!("{payload:?}")
    };

    assert!(
        msg.contains(expected_substring),
        "{case}: expected panic message to contain '{expected_substring}', got '{msg}'"
    );
}

pub(in crate::tests) fn filter_item_inputs_excluding_labels(
    excluded: &[&str],
) -> Vec<(&'static str, proc_macro2::TokenStream)> {
    item_inputs().into_iter().filter(|(label, _)| !excluded.iter().any(|x| x == label)).collect()
}

/// Canonical list of syntactically-valid `syn::Item` inputs.
///
/// Keep this list broad and reusable; other helpers should filter it by AST kind.
pub(in crate::tests) fn item_inputs() -> Vec<(&'static str, proc_macro2::TokenStream)> {
    vec![
        (
            "struct",
            quote::quote! {
                struct AStruct {
                    field: u32,
                }
            },
        ),
        (
            "enum",
            quote::quote! {
                enum AnEnum {
                    Variant1,
                    Variant2,
                }
            },
        ),
        ("function", quote::quote! { fn a_function() {} }),
        ("macro invocation", quote::quote! { some_macro!(); }),
        ("const item", quote::quote! { const A_CONST: u32 = 1; }),
        ("static item", quote::quote! { static A_STATIC: u32 = 1; }),
        ("use item", quote::quote! { use core::mem; }),
        ("mod item", quote::quote! { mod a_module {} }),
        ("extern crate", quote::quote! { extern crate core; }),
        (
            "union",
            quote::quote! {
                union AUnion {
                    a: u32,
                    b: u32,
                }
            },
        ),
        (
            "impl block",
            quote::quote! {
                impl SomeType {
                    fn method(&self) {}
                }
            },
        ),
        (
            "trait",
            quote::quote! {
                trait ATrait {
                    fn method(&self);
                }
            },
        ),
        ("type alias", quote::quote! { type AnAlias = u32; }),
    ]
}
