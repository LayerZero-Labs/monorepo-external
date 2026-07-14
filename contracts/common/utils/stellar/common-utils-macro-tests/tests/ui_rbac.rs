#[test]
fn ui_rbac() {
    // Important: set this before trybuild::TestCases::new() so each shard has
    // its own trybuild project directory + lock + artifacts.
    let target_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/trybuild-shards/ui_rbac");
    std::env::set_var("CARGO_TARGET_DIR", target_dir.as_os_str());

    let t = trybuild::TestCases::new();
    t.pass("tests/ui/rbac/**/pass/*.rs");
    t.compile_fail("tests/ui/rbac/**/fail/*.rs");
}

