fn main() {
    if !std::path::Path::new("../../dependencies").exists() {
        panic!(
            "\n\n\
             ╔══════════════════════════════════════════════════════════════╗\n\
             ║  dependencies/ not found                                     ║\n\
             ║                                                              ║\n\
             ║  Cargo dependencies are managed through pnpm.                ║\n\
             ║  Run: pnpm resolve-dependencies                              ║\n\
             ╚══════════════════════════════════════════════════════════════╝\n"
        );
    }
}
