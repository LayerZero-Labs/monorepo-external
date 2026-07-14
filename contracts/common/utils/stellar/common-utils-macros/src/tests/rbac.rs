use proc_macro2::TokenStream;
use quote::quote;

use crate::tests::test_helpers::{assert_panics_contains, filter_item_inputs_excluding_labels};

// ============================================
// Snapshot Test: has_role and only_role
// ============================================

#[test]
fn snapshot_preserve_function_signature() {
    let args = quote! { caller, "minter" };
    let input = quote! {
        pub fn mint(env: Env, caller: Address, amount: i128) {
            // mint logic
        }
    };

    let has_role_result = crate::rbac::generate_role_check(args.clone(), input.clone(), false);
    let has_role_formatted =
        prettyplease::unparse(&syn::parse2::<syn::File>(has_role_result).expect("failed to parse generated code"));

    let only_role_result = crate::rbac::generate_role_check(args, input, true);
    let only_role_formatted =
        prettyplease::unparse(&syn::parse2::<syn::File>(only_role_result).expect("failed to parse generated code"));

    let combined =
        format!("// === has_role ===\n\n{}\n\n// === only_role ===\n\n{}", has_role_formatted, only_role_formatted);

    insta::assert_snapshot!(combined);
}

// ============================================
// generate_role_check assertion tests
// ============================================

fn assert_stmt_eq(stmt: &syn::Stmt, expected: &str, test_name: &str) {
    let actual = quote::quote!(#stmt).to_string().replace(" ", "");
    assert_eq!(actual, expected, "{test_name}: expected '{expected}', got '{actual}'");
}

fn assert_role_check_exact_stmts(
    args: TokenStream,
    input: TokenStream,
    require_auth: bool,
    expected_ensure_stmt_no_spaces: &str,
    expected_auth_stmt_no_spaces: Option<&str>,
    expected_stmt_count: Option<usize>,
    test_name: &str,
) -> syn::ItemFn {
    let result_tokens = crate::rbac::generate_role_check(args, input, require_auth);
    let output_fn: syn::ItemFn =
        syn::parse2(result_tokens).unwrap_or_else(|e| panic!("{test_name}: failed to parse output function: {e}"));

    assert!(!output_fn.block.stmts.is_empty(), "{test_name}: function body should contain at least one statement");

    assert_stmt_eq(&output_fn.block.stmts[0], expected_ensure_stmt_no_spaces, test_name);

    if let Some(expected_auth) = expected_auth_stmt_no_spaces {
        assert!(output_fn.block.stmts.len() >= 2, "{test_name}: expected at least two statements");
        assert_stmt_eq(&output_fn.block.stmts[1], expected_auth, test_name);
    }

    if let Some(expected_count) = expected_stmt_count {
        assert_eq!(
            output_fn.block.stmts.len(),
            expected_count,
            "{test_name}: expected {expected_count} statements, got {}",
            output_fn.block.stmts.len()
        );
    }

    output_fn
}

#[test]
fn test_role_check_inserts_expected_statements_table_driven() {
    struct Case {
        name: &'static str,
        args: TokenStream,
        input: TokenStream,
        require_auth: bool,
        expected_ensure_stmt: &'static str,
        expected_auth_stmt: Option<&'static str>,
        expected_stmt_count: usize,
    }

    let cases = vec![
        Case {
            name: "has_role: Env ref + Address value",
            args: quote! { caller, "minter" },
            input: quote! { pub fn mint(env: &Env, caller: Address, amount: i128) {} },
            require_auth: false,
            expected_ensure_stmt: "utils::rbac::ensure_role::<Self>(env,&soroban_sdk::Symbol::new(env,\"minter\"),&caller);",
            expected_auth_stmt: None,
            expected_stmt_count: 1,
        },
        Case {
            name: "only_role: Env owned + Address value",
            args: quote! { caller, "minter" },
            input: quote! { pub fn mint(env: Env, caller: Address, amount: i128) {} },
            require_auth: true,
            expected_ensure_stmt: "utils::rbac::ensure_role::<Self>(&env,&soroban_sdk::Symbol::new(&env,\"minter\"),&caller);",
            expected_auth_stmt: Some("caller.require_auth();"),
            expected_stmt_count: 2,
        },
        Case {
            name: "only_role: Env ref + Address value",
            args: quote! { caller, "minter" },
            input: quote! { pub fn mint(env: &Env, caller: Address, amount: i128) {} },
            require_auth: true,
            expected_ensure_stmt: "utils::rbac::ensure_role::<Self>(env,&soroban_sdk::Symbol::new(env,\"minter\"),&caller);",
            expected_auth_stmt: Some("caller.require_auth();"),
            expected_stmt_count: 2,
        },
        Case {
            name: "has_role: &Address param uses account directly",
            args: quote! { account, "admin" },
            input: quote! { pub fn admin_action(env: Env, account: &Address) {} },
            require_auth: false,
            expected_ensure_stmt: "utils::rbac::ensure_role::<Self>(&env,&soroban_sdk::Symbol::new(&env,\"admin\"),account);",
            expected_auth_stmt: None,
            expected_stmt_count: 1,
        },
    ];

    for c in cases {
        assert_role_check_exact_stmts(
            c.args,
            c.input,
            c.require_auth,
            c.expected_ensure_stmt,
            c.expected_auth_stmt,
            Some(c.expected_stmt_count),
            c.name,
        );
    }
}

#[test]
fn test_has_role_role_arg_variants_generate_expected_symbol_new_table_driven() {
    struct Case {
        name: &'static str,
        args: TokenStream,
        input: TokenStream,
        expected_ensure_stmt: &'static str,
    }

    let cases = vec![
        Case {
            name: "role string literal passed to Symbol::new (Env ref)",
            args: quote! { caller, "minter" },
            input: quote! { pub fn mint(env: &Env, caller: Address) {} },
            expected_ensure_stmt: "utils::rbac::ensure_role::<Self>(env,&soroban_sdk::Symbol::new(env,\"minter\"),&caller);",
        },
        Case {
            name: "role const expr passed to Symbol::new (Env ref)",
            args: quote! { caller, MINTER_ROLE },
            input: quote! { pub fn mint(env: &Env, caller: Address) {} },
            expected_ensure_stmt: "utils::rbac::ensure_role::<Self>(env,&soroban_sdk::Symbol::new(env,MINTER_ROLE),&caller);",
        },
        Case {
            name: "role const expr passed to Symbol::new (Env owned)",
            args: quote! { caller, MINTER_ROLE },
            input: quote! { pub fn mint(env: Env, caller: Address) {} },
            expected_ensure_stmt: "utils::rbac::ensure_role::<Self>(&env,&soroban_sdk::Symbol::new(&env,MINTER_ROLE),&caller);",
        },
        Case {
            name: "role path expr passed to Symbol::new",
            args: quote! { caller, roles::MINTER_ROLE },
            input: quote! { pub fn mint(env: &Env, caller: Address) {} },
            expected_ensure_stmt:
                "utils::rbac::ensure_role::<Self>(env,&soroban_sdk::Symbol::new(env,roles::MINTER_ROLE),&caller);",
        },
    ];

    for c in cases {
        assert_role_check_exact_stmts(c.args, c.input, false, c.expected_ensure_stmt, None, Some(1), c.name);
    }
}

// ============================================
// Error cases: invalid args (table-driven)
// ============================================

#[test]
fn test_has_role_rejects_invalid_args_table_driven() {
    struct Case {
        name: &'static str,
        args: TokenStream,
        expected_substring: &'static str,
    }

    let input = quote! { pub fn mint(env: Env, caller: Address) {} };
    let cases = vec![
        Case {
            name: "missing comma in args",
            args: quote! { caller "minter" },
            expected_substring: "failed to parse has_role/only_role args",
        },
        Case {
            name: "missing role",
            args: quote! { caller, },
            expected_substring: "failed to parse has_role/only_role args",
        },
        Case {
            name: "extra tokens in args",
            args: quote! { caller, "minter", extra },
            expected_substring: "failed to parse has_role/only_role args",
        },
    ];

    for c in cases {
        assert_panics_contains(c.name, c.expected_substring, || {
            crate::rbac::generate_role_check(c.args.clone(), input.clone(), false);
        });
    }
}

// ============================================
// Error cases: invalid function signature inputs (table-driven)
// ============================================

#[test]
fn test_has_role_rejects_invalid_function_signature_table_driven() {
    struct Case {
        name: &'static str,
        args: TokenStream,
        input: TokenStream,
        expected_substring: &'static str,
    }

    let args = quote! { caller, "minter" };
    let cases = vec![
        Case {
            name: "no Env param",
            args: args.clone(),
            input: quote! { pub fn mint(caller: Address, amount: i128) {} },
            expected_substring: "function must have an Env argument",
        },
        Case {
            name: "param not in signature",
            args: args.clone(),
            input: quote! { pub fn mint(env: Env, account: Address, amount: i128) {} },
            expected_substring: "not found in function signature",
        },
        Case {
            name: "param not Address",
            args: args.clone(),
            input: quote! { pub fn mint(env: Env, caller: u32, amount: i128) {} },
            expected_substring: "must be of type `Address` or `&Address`",
        },
        Case {
            name: "wildcard Env pattern",
            args: args.clone(),
            input: quote! { pub fn mint(_: Env, caller: Address) {} },
            expected_substring: "function must have an Env argument",
        },
        Case {
            name: "tuple Env pattern",
            args: args.clone(),
            input: quote! { pub fn mint((env, _): (&Env, u32), caller: Address) { let _ = env; } },
            expected_substring: "function must have an Env argument",
        },
        Case {
            name: "struct Env pattern",
            args: args.clone(),
            input: quote! { pub fn mint(Env { .. }: Env, caller: Address) {} },
            expected_substring: "function must have an Env argument",
        },
        Case {
            name: "&&Address is invalid",
            args: args.clone(),
            input: quote! { pub fn mint(env: &Env, caller: &&Address) {} },
            expected_substring: "must be of type `Address` or `&Address`",
        },
    ];

    for c in cases {
        assert_panics_contains(c.name, c.expected_substring, || {
            crate::rbac::generate_role_check(c.args.clone(), c.input.clone(), false);
        });
    }
}

// ============================================
// Error cases: non-function input
// ============================================

#[test]
fn test_has_role_rejects_non_function_inputs() {
    let args = quote! { caller, "minter" };
    for (case, input) in filter_item_inputs_excluding_labels(&["function"]) {
        assert_panics_contains(case, "failed to parse function", || {
            crate::rbac::generate_role_check(args.clone(), input.clone(), false);
        });
    }
}

// ============================================
// High-value coverage: Env + Address + role variants (table-driven)
// ============================================

#[test]
fn test_has_role_env_variants_generate_correct_env_ref_in_ensure_role() {
    struct Case {
        name: &'static str,
        input: TokenStream,
        expected_ensure_stmt: &'static str,
    }

    // Role is a literal so we also validate Symbol::new uses the same env_ref form.
    let args = quote! { caller, "minter" };

    let cases = vec![
        Case {
            name: "owned Env",
            input: quote! { pub fn mint(env: Env, caller: Address) {} },
            expected_ensure_stmt: "utils::rbac::ensure_role::<Self>(&env,&soroban_sdk::Symbol::new(&env,\"minter\"),&caller);",
        },
        Case {
            name: "ref Env",
            input: quote! { pub fn mint(env: &Env, caller: Address) {} },
            expected_ensure_stmt: "utils::rbac::ensure_role::<Self>(env,&soroban_sdk::Symbol::new(env,\"minter\"),&caller);",
        },
        Case {
            name: "mut ref Env",
            input: quote! { pub fn mint(env: &mut Env, caller: Address) {} },
            expected_ensure_stmt: "utils::rbac::ensure_role::<Self>(env,&soroban_sdk::Symbol::new(env,\"minter\"),&caller);",
        },
        Case {
            name: "qualified owned Env",
            input: quote! { pub fn mint(env: soroban_sdk::Env, caller: Address) {} },
            expected_ensure_stmt: "utils::rbac::ensure_role::<Self>(&env,&soroban_sdk::Symbol::new(&env,\"minter\"),&caller);",
        },
        Case {
            name: "qualified ref Env",
            input: quote! { pub fn mint(env: &soroban_sdk::Env, caller: Address) {} },
            expected_ensure_stmt: "utils::rbac::ensure_role::<Self>(env,&soroban_sdk::Symbol::new(env,\"minter\"),&caller);",
        },
        Case {
            name: "leading :: qualified owned Env",
            input: quote! { pub fn mint(env: ::soroban_sdk::Env, caller: Address) {} },
            expected_ensure_stmt: "utils::rbac::ensure_role::<Self>(&env,&soroban_sdk::Symbol::new(&env,\"minter\"),&caller);",
        },
    ];

    for c in cases {
        assert_role_check_exact_stmts(args.clone(), c.input, false, c.expected_ensure_stmt, None, Some(1), c.name);
    }
}

#[test]
fn test_has_role_address_variants_generate_correct_param_reference() {
    struct Case {
        name: &'static str,
        input: TokenStream,
        expected_ensure_stmt: &'static str,
    }

    let args = quote! { caller, "minter" };

    let cases = vec![
        Case {
            name: "Address by value -> &caller",
            input: quote! { pub fn mint(env: &Env, caller: Address) {} },
            expected_ensure_stmt: "utils::rbac::ensure_role::<Self>(env,&soroban_sdk::Symbol::new(env,\"minter\"),&caller);",
        },
        Case {
            name: "&Address -> caller",
            input: quote! { pub fn mint(env: &Env, caller: &Address) {} },
            expected_ensure_stmt: "utils::rbac::ensure_role::<Self>(env,&soroban_sdk::Symbol::new(env,\"minter\"),caller);",
        },
        Case {
            name: "&mut Address -> caller",
            input: quote! { pub fn mint(env: &Env, caller: &mut Address) {} },
            expected_ensure_stmt: "utils::rbac::ensure_role::<Self>(env,&soroban_sdk::Symbol::new(env,\"minter\"),caller);",
        },
        Case {
            name: "qualified Address by value",
            input: quote! { pub fn mint(env: &Env, caller: soroban_sdk::Address) {} },
            expected_ensure_stmt: "utils::rbac::ensure_role::<Self>(env,&soroban_sdk::Symbol::new(env,\"minter\"),&caller);",
        },
        Case {
            name: "qualified &Address",
            input: quote! { pub fn mint(env: &Env, caller: &soroban_sdk::Address) {} },
            expected_ensure_stmt: "utils::rbac::ensure_role::<Self>(env,&soroban_sdk::Symbol::new(env,\"minter\"),caller);",
        },
    ];

    for c in cases {
        assert_role_check_exact_stmts(args.clone(), c.input, false, c.expected_ensure_stmt, None, Some(1), c.name);
    }
}

#[test]
fn test_only_role_inserts_expected_statements_and_preserves_original_body() {
    let args = quote! { caller, "minter" };
    let input = quote! {
        pub fn mint(env: Env, caller: Address) {
            let x = 1u32;
            let _ = x + 1;
        }
    };

    let output_fn = assert_role_check_exact_stmts(
        args,
        input,
        true,
        "utils::rbac::ensure_role::<Self>(&env,&soroban_sdk::Symbol::new(&env,\"minter\"),&caller);",
        Some("caller.require_auth();"),
        Some(4),
        "only_role inserts ensure_role + require_auth",
    );

    // Ensure original statements remain after the inserted checks.
    let third_stmt = &output_fn.block.stmts[2];
    let third_stmt_str = quote::quote!(#third_stmt).to_string().replace(" ", "");
    assert!(third_stmt_str.starts_with("letx=1u32;"), "expected original 'let x = 1u32;' to be preserved");
}

// ============================================
// AUTHORIZER: snapshot test
// ============================================

#[test]
fn snapshot_authorizer_role() {
    let args = quote! { operator, AUTHORIZER };
    let input = quote! {
        pub fn admin_action(env: Env, operator: Address) {
            // admin logic
        }
    };

    let has_role_result = crate::rbac::generate_role_check(args.clone(), input.clone(), false);
    let has_role_formatted =
        prettyplease::unparse(&syn::parse2::<syn::File>(has_role_result).expect("failed to parse generated code"));

    let only_role_result = crate::rbac::generate_role_check(args, input, true);
    let only_role_formatted =
        prettyplease::unparse(&syn::parse2::<syn::File>(only_role_result).expect("failed to parse generated code"));

    let combined = format!(
        "// === has_role(operator, AUTHORIZER) ===\n\n{}\n\n// === only_role(operator, AUTHORIZER) ===\n\n{}",
        has_role_formatted, only_role_formatted
    );

    insta::assert_snapshot!(combined);
}

// ============================================
// AUTHORIZER: table-driven assertion tests
// ============================================

#[test]
fn test_authorizer_role_generates_auth_check_instead_of_ensure_role() {
    struct Case {
        name: &'static str,
        args: TokenStream,
        input: TokenStream,
        require_auth: bool,
        expected_ensure_stmt: &'static str,
        expected_auth_stmt: Option<&'static str>,
        expected_stmt_count: usize,
    }

    let cases = vec![
        Case {
            name: "has_role with AUTHORIZER: Env ref + Address value",
            args: quote! { operator, AUTHORIZER },
            input: quote! { pub fn admin_action(env: &Env, operator: Address) {} },
            require_auth: false,
            expected_ensure_stmt: "utils::rbac::ensure_role::<Self>(env,&soroban_sdk::Symbol::new(env,AUTHORIZER),&operator);",
            expected_auth_stmt: None,
            expected_stmt_count: 1,
        },
        Case {
            name: "only_role with AUTHORIZER: Env owned + Address value",
            args: quote! { operator, AUTHORIZER },
            input: quote! { pub fn admin_action(env: Env, operator: Address) {} },
            require_auth: true,
            expected_ensure_stmt: "utils::rbac::ensure_role::<Self>(&env,&soroban_sdk::Symbol::new(&env,AUTHORIZER),&operator);",
            expected_auth_stmt: Some("operator.require_auth();"),
            expected_stmt_count: 2,
        },
        Case {
            name: "only_role with AUTHORIZER: Env ref + &Address",
            args: quote! { operator, AUTHORIZER },
            input: quote! { pub fn admin_action(env: &Env, operator: &Address) {} },
            require_auth: true,
            expected_ensure_stmt: "utils::rbac::ensure_role::<Self>(env,&soroban_sdk::Symbol::new(env,AUTHORIZER),operator);",
            expected_auth_stmt: Some("operator.require_auth();"),
            expected_stmt_count: 2,
        },
    ];

    for c in cases {
        assert_role_check_exact_stmts(
            c.args,
            c.input,
            c.require_auth,
            c.expected_ensure_stmt,
            c.expected_auth_stmt,
            Some(c.expected_stmt_count),
            c.name,
        );
    }
}

#[test]
fn test_non_authorizer_role_still_uses_ensure_role() {
    let args = quote! { caller, MINTER_ROLE };
    let input = quote! { pub fn mint(env: &Env, caller: Address) {} };
    assert_role_check_exact_stmts(
        args,
        input,
        false,
        "utils::rbac::ensure_role::<Self>(env,&soroban_sdk::Symbol::new(env,MINTER_ROLE),&caller);",
        None,
        Some(1),
        "non-AUTHORIZER const still goes through ensure_role",
    );
}
