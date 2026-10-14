//! Cross-program SBF suite. Unit invariants live beside the code and single-program boundaries in
//! `programs/console_oft/tests`; this suite proves the pieces compose under the real runtime.
#[path = "../../programs/console_oft/tests/oft/mod.rs"]
mod oft;

mod account_extensions;
mod admin;
mod budget;
mod compose;
mod configurations;
mod deploy;
mod harness;
mod receive;
mod send;
