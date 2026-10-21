//! Minimal program that exercises `heap_allocator::declare_allocator!()`.
//!
//! `allocate` grows a `Vec` on the program heap and returns `heap_used()`, which
//! proves the custom bump allocator is installed and can use heap frames beyond
//! the default 32 KiB region.

use anchor_lang::prelude::*;

#[cfg(all(feature = "custom-heap", not(feature = "no-entrypoint"), target_os = "solana"))]
heap_allocator::declare_allocator!();

declare_id!("2ow6zJCHwFMKASwLUEEPZJKr687q5yFtYthNXBTzaJFc");

#[program]
pub mod demo {
    use super::*;

    /// No-op smoke instruction.
    pub fn ping(_ctx: Context<Empty>) -> Result<()> {
        Ok(())
    }

    /// Allocate `size` bytes on the heap and return bytes used by the bump allocator.
    pub fn allocate(_ctx: Context<Empty>, size: u32) -> Result<u64> {
        // Keep the allocation live so the bump pointer advances.
        let buf = vec![0u8; size as usize];
        core::hint::black_box(&buf);
        Ok(heap_used())
    }
}

#[derive(Accounts)]
pub struct Empty {}

fn heap_used() -> u64 {
    #[cfg(all(feature = "custom-heap", not(feature = "no-entrypoint"), target_os = "solana"))]
    {
        crate::allocator::heap_used() as u64
    }
    #[cfg(not(all(
        feature = "custom-heap",
        not(feature = "no-entrypoint"),
        target_os = "solana"
    )))]
    {
        0
    }
}
