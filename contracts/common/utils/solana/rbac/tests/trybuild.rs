//! Compile-time tests for RBAC macros using trybuild.
//!
//! These tests verify that invalid macro usage produces helpful error messages.
//!
//! Note: Valid usage examples are in the `examples/` directory. They can't be
//! run as trybuild tests because the macros generate Anchor code that requires
//! a full program context (`#[program]`, `event_cpi`, etc.). Valid usage is
//! tested via the OFT program's integration tests.

#[test]
fn ui() {
    let t = trybuild::TestCases::new();

    t.compile_fail("tests/ui/fail_init_default_admin_tuple_struct.rs");
    t.compile_fail("tests/ui/fail_missing_program_state.rs");
    t.compile_fail("tests/ui/fail_only_role_missing_authority.rs");
    t.compile_fail("tests/ui/fail_only_role_missing_role.rs");
    t.compile_fail("tests/ui/fail_only_role_missing_state.rs");
    t.compile_fail("tests/ui/fail_only_role_tuple_struct.rs");
    t.compile_fail("tests/ui/fail_only_role_unknown_attribute.rs");
    t.compile_fail("tests/ui/fail_program_rbac_existing_bad_signature.rs");
    t.compile_fail("tests/ui/fail_rbac_missing_role_type.rs");
    t.compile_fail("tests/ui/fail_rbac_unknown_attribute.rs");
    t.compile_fail("tests/ui/fail_role_type_default_nonzero.rs");
    t.compile_fail("tests/ui/fail_role_type_missing_default.rs");
    t.compile_fail("tests/ui/fail_role_type_non_unit.rs");
    t.compile_fail("tests/ui/fail_role_type_not_enum.rs");
    t.pass("tests/pass/init_default_admin.rs");
    t.pass("tests/pass/role_type_derive.rs");
}
