//! LayerZero View Contract for Stellar
//!
//! This crate provides the `LayerZeroView` contract for querying LayerZero protocol state:
//!
//! **Endpoint View Functions:**
//! - `initializable`: Check if a messaging path can be initialized
//! - `verifiable`: Check if a message can be verified at the endpoint
//! - `executable`: Get the execution state of a message
//!
//! **ULN302 View Functions:**
//! - `uln_verifiable`: Get combined verification state (endpoint + DVN checks)
//!
//! These contracts are designed for use by:
//! - **Executors**: To check when messages are ready for execution
//! - **DVNs**: To track verification progress
//! - **Block Explorers/UIs**: To display message status to users

#![no_std]

mod errors;
mod layerzero_view;
mod storage;
mod types;

#[cfg(test)]
mod tests;

// Re-export contract
pub use layerzero_view::{LayerZeroView, LayerZeroViewClient};

// Re-export storage
pub use storage::LayerZeroViewStorage;

// Re-export types
pub use types::{empty_payload_hash, nil_payload_hash, ExecutionState, VerificationState};

// Re-export errors
pub use errors::LayerZeroViewError;
