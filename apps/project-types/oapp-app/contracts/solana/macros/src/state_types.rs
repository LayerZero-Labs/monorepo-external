//! State struct generators for the `#[oapp]` macro.
//!
//! Contains token-stream generators for OApp state account types:
//! - `OAppPeer` — the peer account definition.
//! - `EnforcedOptions` — the enforced-options account definition.

use proc_macro2::TokenStream;
use quote::quote;

/// Generates the `OAppPeer` struct with inherent accessor methods.
pub fn generate_peer() -> TokenStream {
    quote! {
        #[account]
        #[derive(Default, InitSpace)]
        pub struct OAppPeer {
            pub address: [u8; 32],
            pub bump: u8,
        }

        impl OAppPeer {
            /// Returns the configured peer address, or fails if it is the zero address.
            pub fn get_address(&self) -> ::anchor_lang::prelude::Result<[u8; 32]> {
                ::anchor_lang::prelude::require!(
                    self.address != [0u8; 32],
                    ::oapp::OAppError::NoPeer
                );
                Ok(self.address)
            }

            /// PDA seeds for the per-EID peer.
            /// Seed shape: [PEER_SEED, oapp_key, eid_be4]
            pub fn seeds(oapp: &Pubkey, eid: u32) -> &'static [&'static [u8]] {
                let key_bytes: &'static [u8; 32] = Box::leak(Box::new(oapp.to_bytes()));
                let eid_bytes: &'static [u8; 4] = Box::leak(Box::new(eid.to_be_bytes()));
                Box::leak(Box::new([
                    ::oapp::PEER_SEED,
                    key_bytes.as_slice(),
                    eid_bytes.as_slice(),
                ]))
            }
        }
    }
}

/// Generates the default `EnforcedOptions` account struct.
pub fn generate_enforced_options() -> TokenStream {
    quote! {
        #[account]
        pub struct EnforcedOptions {
            pub options: Vec<u8>,
            pub bump: u8,
        }

        impl EnforcedOptions {
            /// Returns the total account space required for the given options length.
            ///
            /// Borsh serializes fields in declaration order, so the on-disk layout is:
            /// discriminator (8) + vec_len_prefix (4) + options_data + bump (1)
            pub fn space(options_len: usize) -> usize {
                8 + 4 + options_len + 1
            }

            /// PDA seeds for the per-EID, per-msg-type enforced-options account.
            /// Seed shape: [ENFORCED_OPTIONS_SEED, oapp_key, eid_be4, msg_type_be2]
            pub fn seeds(oapp: &Pubkey, eid: u32, msg_type: u16) -> &'static [&'static [u8]] {
                let key_bytes: &'static [u8; 32] = Box::leak(Box::new(oapp.to_bytes()));
                let eid_bytes: &'static [u8; 4] = Box::leak(Box::new(eid.to_be_bytes()));
                let msg_type_bytes: &'static [u8; 2] =
                    Box::leak(Box::new(msg_type.to_be_bytes()));
                Box::leak(Box::new([
                    ::oapp::ENFORCED_OPTIONS_SEED,
                    key_bytes.as_slice(),
                    eid_bytes.as_slice(),
                    msg_type_bytes.as_slice(),
                ]))
            }
        }
    }
}
