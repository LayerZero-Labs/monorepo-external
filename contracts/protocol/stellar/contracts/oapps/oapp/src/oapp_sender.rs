use crate::{
    errors::OAppError,
    oapp_core::{endpoint_client, get_peer_or_panic, OAppCore},
};
use endpoint_v2::{MessagingFee, MessagingParams, MessagingReceipt};
use soroban_sdk::{contracttype, token::TokenClient, Address, Bytes, Env};
use utils::option_ext::OptionExt;

/// The version of the OAppSender implementation.
/// Version is bumped when changes are made to this contract.
pub const SENDER_VERSION: u64 = 1;

/// Represents a fee payer address with explicit authorization state.
///
/// This enum forces callers of `__lz_send` to explicitly declare whether
/// `require_auth()` has already been called for the fee payer address.
/// This prevents the common mistake of forgetting to authorize the fee payer.
///
/// # Variants
/// - `Unverified` — Safe default. `__lz_send` will call `require_auth()` on the address.
///   Use this when the caller has **not** already authorized the fee payer.
/// - `Verified` — Caller asserts that `require_auth()` has already been called.
///   Use this to avoid a duplicate `require_auth()` node in the Soroban auth tree
///   (e.g., when the same address was already authorized as the message sender).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FeePayer {
    /// The fee payer has **not** been authorized yet.
    /// `__lz_send` will call `fee_payer.require_auth()` before transferring fees.
    /// This is the safe default — use this if unsure.
    Unverified(Address),

    /// The fee payer has **already** been authorized by the caller via `require_auth()`.
    /// `__lz_send` will skip the auth check to avoid creating a duplicate auth node
    /// in the Soroban authorization tree.
    ///
    /// # Safety
    /// Only use this variant if you have already called `require_auth()` on this address
    /// in the current contract invocation. Misuse may allow unauthorized fee deductions.
    Verified(Address),
}

impl FeePayer {
    /// Returns a reference to the underlying address.
    pub fn address(&self) -> &Address {
        match self {
            FeePayer::Unverified(addr) | FeePayer::Verified(addr) => addr,
        }
    }
}

/// A helper trait for sending cross-chain messages via LayerZero.
///
/// Contracts should implement this trait to gain access to the `__quote` and `__lz_send` helper
/// methods for cross-chain messaging. This trait provides default implementations that handle
/// fee payment and message dispatch through the LayerZero endpoint.
///
/// # Important
/// This trait is intended to be used as an **internal helper** only. Do **NOT** expose these
/// methods as part of your contract's public interface (i.e., do not use `#[contract_impl]` on
/// the implementation of this trait). Instead, call these methods internally from your
/// contract's own public functions.
pub trait OAppSenderInternal: OAppCore {
    /// Quote the messaging fee for sending a message to the other chain
    ///
    /// # Arguments
    /// * `dst_eid`: The destination endpoint ID
    /// * `message`: The message to send
    /// * `options`: The options for the message
    /// * `pay_in_zro`: Whether to pay the fee in ZRO
    ///
    /// # Returns
    /// * `MessagingFee`: The messaging fee for the message
    fn __quote(env: &Env, dst_eid: u32, message: &Bytes, options: &Bytes, pay_in_zro: bool) -> MessagingFee {
        let receiver = get_peer_or_panic::<Self>(env, dst_eid);
        endpoint_client::<Self>(env).quote(
            &env.current_contract_address(),
            &MessagingParams { dst_eid, receiver, message: message.clone(), options: options.clone(), pay_in_zro },
        )
    }

    /// Send a message to the other chain
    ///
    /// # Arguments
    /// * `dst_eid`: The destination endpoint ID
    /// * `message`: The message to send
    /// * `options`: The options for the message
    /// * `fee_payer`: The fee payer, wrapped in [`FeePayer`] to indicate authorization state.
    ///   Use `FeePayer::Unverified(addr)` if auth has not been checked (safe default),
    ///   or `FeePayer::Verified(addr)` if `addr.require_auth()` was already called by the caller.
    /// * `fee`: The messaging fee
    /// * `refund_address`: The address to receive any excess fees
    ///
    /// # Returns
    /// * `MessagingReceipt`: The receipt for the sent message
    fn __lz_send(
        env: &Env,
        dst_eid: u32,
        message: &Bytes,
        options: &Bytes,
        fee_payer: &FeePayer,
        fee: &MessagingFee,
        refund_address: &Address,
    ) -> MessagingReceipt {
        // Enforce fee payer authorization if not already verified by the caller
        let payer = match fee_payer {
            FeePayer::Unverified(addr) => {
                addr.require_auth();
                addr
            }
            FeePayer::Verified(addr) => addr,
        };

        // Pay the messaging fees
        Self::__pay_native(env, payer, fee.native_fee);
        // Skip the ZRO payment call only when the fee is exactly zero. Using `!= 0` instead of
        // `> 0` so that an invalid negative value still reaches `__pay_zro` and fails loudly
        // rather than being silently ignored.
        let pay_in_zro = fee.zro_fee != 0;
        if pay_in_zro {
            Self::__pay_zro(env, payer, fee.zro_fee);
        }

        // Send the message to the other chain
        let receiver = get_peer_or_panic::<Self>(env, dst_eid);
        endpoint_client::<Self>(env).send(
            &env.current_contract_address(),
            &MessagingParams { dst_eid, receiver, message: message.clone(), options: options.clone(), pay_in_zro },
            refund_address,
        )
    }

    /// Pay the native fee to the endpoint for sending a message to the other chain
    ///
    /// # Arguments
    /// * `fee_payer`: The address of the fee payer
    /// * `native_fee`: The native fee to pay
    fn __pay_native(env: &Env, fee_payer: &Address, native_fee: i128) {
        let token_client = TokenClient::new(env, &endpoint_client::<Self>(env).native_token());
        token_client.transfer(fee_payer, Self::endpoint(env), &native_fee);
    }

    /// Pay the ZRO fee to the endpoint for sending a message to the other chain
    ///
    /// # Arguments
    /// * `fee_payer`: The address of the fee payer
    /// * `zro_fee`: The ZRO fee to pay
    fn __pay_zro(env: &Env, fee_payer: &Address, zro_fee: i128) {
        let zro_token = endpoint_client::<Self>(env).zro().unwrap_or_panic(env, OAppError::ZroTokenUnavailable);
        TokenClient::new(env, &zro_token).transfer(fee_payer, Self::endpoint(env), &zro_fee);
    }
}
