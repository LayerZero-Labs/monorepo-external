//! Unit tests for the `is_primitive_type` function.

use crate::storage::test::is_primitive_type_for_test;

#[test]
fn test_recognizes_primitive_types() {
    let primitives = ["u32", "i32", "u64", "i64", "u128", "i128", "bool"];
    for ty_str in primitives {
        let ty = syn::parse_str::<syn::Type>(ty_str).expect("failed to parse type");
        assert!(is_primitive_type_for_test(&ty), "{ty_str} should be recognized as primitive");
    }
}

#[test]
fn test_rejects_non_primitive_types() {
    let non_primitives = [
        "u8",    // not in primitive list
        "usize", // not in primitive list
        "String",
        "Address",
        "Vec<u8>",
        "Option<u32>",
        "std::u32", // multi-segment path
        "soroban_sdk::Address",
    ];

    for ty_str in non_primitives {
        let ty = syn::parse_str::<syn::Type>(ty_str).expect("failed to parse type");
        assert!(!is_primitive_type_for_test(&ty), "{ty_str} should NOT be recognized as primitive");
    }
}

#[test]
fn test_rejects_other_type_variants() {
    let other_variants = [
        ("&u32", "reference"),
        ("&mut u32", "mutable reference"),
        ("(u32, i32)", "tuple"),
        ("[u32; 4]", "array"),
        ("[u32]", "slice"),
        ("!", "never"),
    ];

    for (ty_str, label) in other_variants {
        let ty = syn::parse_str::<syn::Type>(ty_str).expect("failed to parse type");
        assert!(!is_primitive_type_for_test(&ty), "{label} type {ty_str} should NOT be recognized as primitive");
    }
}
