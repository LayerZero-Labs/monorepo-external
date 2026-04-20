//! OFT - traits and implementations for Omnichain Fungible Tokens.
//!
//! This module provides:
//! - `OFTInternal`: Internal methods NOT exposed as contract entrypoints (`__debit`, `__credit`, `__initialize_oft`, `__receive`, etc.)
//! - `OFTCore`: Public methods exposed as contract entrypoints (using `#[contract_trait]`)
//! - `impl_oft_lz_receive!`: Macro to implement `LzReceiveInternal` with default OFT receive logic
//!
//! ## Usage
//!
//! ```ignore
//! use oapp_macros::oapp;
//! use oft_core::{OFTInternal, OFTCore, impl_oft_lz_receive};
//!
//! #[common_macros::lz_contract]
//! #[oapp]
//! pub struct MyOFT;
//!
//! #[contract_impl]
//! impl MyOFT {
//!     pub fn __constructor(env: &Env, token: &Address, owner: &Address, endpoint: &Address, delegate: &Address) {
//!         Self::__initialize_oft(env, token, 6, owner, endpoint, delegate)
//!     }
//! }
//!
//! // Public methods - exposed as contract entrypoints
//! #[contract_impl(contracttrait)]
//! impl OFTCore for MyOFT {}
//!
//! // Internal methods - NOT exposed as contract entrypoints
//! // IMPORTANT: Do NOT use #[contract_impl] here to keep methods internal
//! impl OFTInternal for MyOFT {
//!     fn __debit(env: &Env, from: &Address, amount_ld: i128, min_amount_ld: i128, dst_eid: u32) -> (i128, i128) {
//!         // Your debit logic: lock tokens (LockUnlock) or burn tokens (MintBurn)
//!     }
//!
//!     fn __credit(env: &Env, to: &Address, amount_ld: i128, src_eid: u32) -> i128 {
//!         // Your credit logic: unlock tokens (LockUnlock) or mint tokens (MintBurn)
//!     }
//! }
//!
//! // LzReceiveInternal - use the macro for default OFT receive logic
//! impl_oft_lz_receive!(MyOFT);
//! ```

use crate::{
    self as oft_core,
    codec::{
        oft_compose_msg_codec::OFTComposeMsg,
        oft_msg_codec::{ComposeData, OFTMessage},
    },
    errors::OFTError,
    events::{self, MsgInspectorSet, OFTSent},
    storage::OFTStorage,
    types::{OFTFeeDetail, OFTLimit, OFTReceipt, SendParam, SEND, SEND_AND_CALL},
    utils as oft_utils,
};
use common_macros::{contract_trait, only_role};
use endpoint_v2::{MessagingComposerClient, MessagingFee, MessagingReceipt};
use oapp::{
    oapp_core::init_ownable_oapp,
    oapp_options_type3::OAppOptionsType3,
    oapp_receiver::OAppReceiver,
    oapp_sender::{FeePayer, OAppSenderInternal},
    OAppMsgInspectorClient,
};
use soroban_sdk::{assert_with_error, token::TokenClient, vec, Address, Bytes, Env, Vec};
use utils::{option_ext::OptionExt, ownable::OwnableInitializer, rbac::AUTHORIZER};

// ===========================================================================
// OFTInternal Trait (NOT exposed as contract entrypoints)
// ===========================================================================

/// Internal OFT trait containing methods that should NOT be exposed as contract entrypoints.
///
/// **IMPORTANT**: Implement this trait WITHOUT the `#[contractimpl]` macro to keep
/// `__debit`, `__credit`, and other internal methods private to the contract.
///
/// ```ignore
/// // Correct - methods stay internal
/// impl OFTInternal for MyOFT { ... }
///
/// // WRONG - would expose methods as entrypoints
/// #[contractimpl]
/// impl OFTInternal for MyOFT { ... }
/// ```
///
/// This trait extends all OApp supertraits and contains both the token operations
/// and the internal sending logic. `OFTCore` serves only as an entrypoint wrapper.
pub trait OFTInternal: OAppReceiver + OAppSenderInternal + OAppOptionsType3 + OwnableInitializer {
    // =========================================================================
    // Initialization
    // =========================================================================

    /// Initializes the OFT (Omnichain Fungible Token) contract.
    ///
    /// Sets up the OApp infrastructure and configures decimal conversion for cross-chain transfers.
    /// The `shared_decimals` parameter defines the common decimal precision used across all chains,
    /// enabling consistent token amounts regardless of each chain's native token decimals.
    ///
    /// # Arguments
    /// * `token` - The underlying token contract address (must implement SEP-41 token interface)
    /// * `shared_decimals` - The shared decimal precision for cross-chain compatibility (must be <= local decimals)
    /// * `owner` - The address that will own this OFT contract
    /// * `endpoint` - The LayerZero endpoint address for cross-chain messaging
    /// * `delegate` - The delegate address for endpoint configuration permissions
    ///
    /// # Panics
    /// * `OFTError::InvalidLocalDecimals` - If the token's local decimals are less than `shared_decimals`
    fn __initialize_oft(
        env: &Env,
        token: &Address,
        shared_decimals: u32,
        owner: &Address,
        endpoint: &Address,
        delegate: &Address,
    ) {
        // Initialize OApp (includes owner initialization)
        init_ownable_oapp::<Self>(env, owner, endpoint, delegate);

        let local_decimals = TokenClient::new(env, token).decimals();
        assert_with_error!(env, local_decimals >= shared_decimals, OFTError::InvalidLocalDecimals);

        // Initialize OFT storage
        OFTStorage::set_token(env, token);
        OFTStorage::set_decimals_diff(env, &(local_decimals - shared_decimals));
    }

    // =========================================================================
    // Required Methods (no defaults - user MUST implement)
    // =========================================================================

    /// Debits tokens from the specified address for cross-chain transfer.
    ///
    /// # Arguments
    /// * `from` - The address to debit the tokens from
    /// * `amount_ld` - The amount of tokens to send in local decimals
    /// * `min_amount_ld` - The minimum amount to send in local decimals
    /// * `dst_eid` - The destination endpoint ID
    ///
    /// # Returns
    /// * `amount_sent_ld` - The amount sent in local decimals
    /// * `amount_received_ld` - The amount received in local decimals on the remote
    fn __debit(env: &Env, from: &Address, amount_ld: i128, min_amount_ld: i128, dst_eid: u32) -> (i128, i128);

    /// Credits tokens to recipient after receiving cross-chain transfer.
    ///
    /// # Arguments
    /// * `to` - The address to credit tokens to
    /// * `amount_ld` - Amount in local decimals to credit
    /// * `src_eid` - Source endpoint ID
    ///
    /// # Returns
    /// The amount actually credited
    fn __credit(env: &Env, to: &Address, amount_ld: i128, src_eid: u32) -> i128;

    // =========================================================================
    // Optional Methods (have defaults - override as needed)
    // =========================================================================

    // ----- Quote Methods -----

    /// Quotes an OFT transfer without executing. Returns (limits, fee details, receipt).
    fn __quote_oft(env: &Env, _from: &Address, send_param: &SendParam) -> (OFTLimit, Vec<OFTFeeDetail>, OFTReceipt) {
        assert_nonnegative_amount(env, send_param);

        let limit = OFTLimit { min_amount_ld: 0, max_amount_ld: u64::MAX as i128 };
        let fee_details = vec![env];
        let (amount_sent_ld, amount_received_ld) =
            Self::__debit_view(env, send_param.amount_ld, send_param.min_amount_ld, send_param.dst_eid);
        (limit, fee_details, OFTReceipt { amount_sent_ld, amount_received_ld })
    }

    /// Quotes the LayerZero messaging fee for a send. Builds the message internally
    /// to get an accurate fee estimate from the endpoint.
    fn __quote_send(env: &Env, from: &Address, send_param: &SendParam, pay_in_zro: bool) -> MessagingFee {
        assert_nonnegative_amount(env, send_param);

        let (_amount_sent_ld, amount_received_ld) =
            Self::__debit_view(env, send_param.amount_ld, send_param.min_amount_ld, send_param.dst_eid);

        let (message, options) = Self::__build_msg_and_options(env, from, send_param, amount_received_ld);
        Self::__quote(env, send_param.dst_eid, &message, &options, pay_in_zro)
    }

    // ----- Send Method -----

    /// Executes a cross-chain token transfer: debits `from`, builds the OFT message,
    /// and dispatches it via the LayerZero endpoint.
    fn __send(
        env: &Env,
        from: &Address,
        send_param: &SendParam,
        fee: &MessagingFee,
        refund_address: &Address,
    ) -> (MessagingReceipt, OFTReceipt) {
        from.require_auth();

        assert_nonnegative_amount(env, send_param);

        let (amount_sent_ld, amount_received_ld) =
            Self::__debit(env, from, send_param.amount_ld, send_param.min_amount_ld, send_param.dst_eid);

        let (message, options) = Self::__build_msg_and_options(env, from, send_param, amount_received_ld);
        let messaging_receipt = Self::__lz_send(
            env,
            send_param.dst_eid,
            &message,
            &options,
            &FeePayer::Verified(from.clone()),
            fee,
            refund_address,
        );

        OFTSent {
            guid: messaging_receipt.guid.clone(),
            dst_eid: send_param.dst_eid,
            from: from.clone(),
            amount_sent_ld,
            amount_received_ld,
        }
        .publish(env);

        (messaging_receipt, OFTReceipt { amount_sent_ld, amount_received_ld })
    }

    // ----- View/Helper Methods -----

    /// Simulates a debit for quoting — removes dust but charges no fee by default.
    /// Override to add custom fee logic. Panics with `SlippageExceeded` if the
    /// resulting amount is below `min_amount_ld`.
    ///
    /// # Returns
    /// * `amount_sent_ld` - The amount sent in local decimals
    /// * `amount_received_ld` - The amount received in local decimals on the remote
    fn __debit_view(env: &Env, amount_ld: i128, min_amount_ld: i128, _dst_eid: u32) -> (i128, i128) {
        let conversion_rate = Self::__decimal_conversion_rate(env);
        let amount_sent_ld = oft_utils::remove_dust(amount_ld, conversion_rate);
        let amount_received_ld = amount_sent_ld;

        assert_with_error!(env, amount_received_ld >= min_amount_ld, OFTError::SlippageExceeded);

        (amount_sent_ld, amount_received_ld)
    }

    /// Encodes the OFT message payload and merges enforced + extra options.
    /// Runs the message inspector (if set) before returning `(message, options)`.
    fn __build_msg_and_options(
        env: &Env,
        from: &Address,
        send_param: &SendParam,
        amount_received_ld: i128,
    ) -> (Bytes, Bytes) {
        let has_compose = !send_param.compose_msg.is_empty();
        let compose_data = has_compose
            .then(|| ComposeData { from: oft_utils::address_payload(env, from), msg: send_param.compose_msg.clone() });

        // Build the OFT message
        let conversion_rate = Self::__decimal_conversion_rate(env);
        let message = OFTMessage {
            send_to: send_param.to.clone(),
            amount_sd: oft_utils::to_sd(env, amount_received_ld, conversion_rate),
            compose: compose_data,
        }
        .encode(env);

        // Combine the options with the message type
        let msg_type = if has_compose { SEND_AND_CALL } else { SEND };
        let options = Self::combine_options(env, send_param.dst_eid, msg_type, &send_param.extra_options);

        // Optionally inspect message and options if inspector is set
        // If it fails inspection, needs to revert in the implementation. ie. does not rely on return boolean
        if let Some(inspector) = Self::__msg_inspector(env) {
            OAppMsgInspectorClient::new(env, &inspector).inspect(&env.current_contract_address(), &message, &options);
        }

        (message, options)
    }

    // ----- Storage Accessors -----

    /// Retrieves the token address associated with this OFT.
    fn __token(env: &Env) -> Address {
        OFTStorage::token(env).unwrap_or_panic(env, OFTError::NotInitialized)
    }

    /// Retrieves the difference between local and shared decimals (`local_decimals - shared_decimals`).
    fn __decimals_diff(env: &Env) -> u32 {
        OFTStorage::decimals_diff(env).unwrap_or_panic(env, OFTError::NotInitialized)
    }

    /// Retrieves the decimal conversion rate used for cross-chain normalization.
    fn __decimal_conversion_rate(env: &Env) -> i128 {
        10_i128.pow(Self::__decimals_diff(env))
    }

    /// Retrieves the shared decimals used for cross-chain normalization.
    fn __shared_decimals(env: &Env) -> u32 {
        let local_decimals = TokenClient::new(env, &Self::__token(env)).decimals();
        local_decimals - Self::__decimals_diff(env)
    }

    /// Returns the message inspector address if set.
    fn __msg_inspector(env: &Env) -> Option<Address> {
        OFTStorage::msg_inspector(env)
    }

    /// Sets or removes the message inspector address.
    fn __set_msg_inspector(env: &Env, inspector: &Option<Address>) {
        OFTStorage::set_or_remove_msg_inspector(env, inspector);
        MsgInspectorSet { inspector: inspector.clone() }.publish(env);
    }

    // ----- Receive Handler -----

    /// Handles incoming cross-chain OFT transfer from LayerZero endpoint.
    ///
    /// Credits tokens to the recipient and optionally queues a compose message.
    /// Override this method to implement custom receive logic (e.g., pausable, rate limiting).
    ///
    /// # Arguments
    /// * `origin` - The origin information (source chain, sender, nonce)
    /// * `guid` - The unique message identifier
    /// * `message` - The encoded OFT message payload
    /// * `extra_data` - Additional data (unused in default implementation)
    /// * `executor` - The address of the executor handling the message (unused in default implementation)
    /// * `value` - The native token value sent with the message (unused in default implementation)
    fn __receive(
        env: &Env,
        origin: &endpoint_v2::Origin,
        guid: &soroban_sdk::BytesN<32>,
        message: &Bytes,
        _extra_data: &Bytes,
        _executor: &Address,
        _value: i128,
    ) {
        let oft_msg = OFTMessage::decode(message);
        let send_to = oft_utils::resolve_address(env, &oft_msg.send_to);

        // Convert the amount to local decimals and credit the recipient
        let conversion_rate = Self::__decimal_conversion_rate(env);
        let amount_received_ld =
            Self::__credit(env, &send_to, oft_utils::to_ld(oft_msg.amount_sd, conversion_rate), origin.src_eid);

        // If there is a compose message, send it
        if let Some(compose) = oft_msg.compose {
            let compose_msg = OFTComposeMsg {
                nonce: origin.nonce,
                src_eid: origin.src_eid,
                amount_ld: amount_received_ld,
                compose_from: compose.from,
                compose_msg: compose.msg,
            }
            .encode(env);

            let endpoint_client = MessagingComposerClient::new(env, &Self::endpoint(env));
            endpoint_client.send_compose(&env.current_contract_address(), &send_to, guid, &0, &compose_msg);
        }

        events::OFTReceived { guid: guid.clone(), src_eid: origin.src_eid, to: send_to, amount_received_ld }
            .publish(env);
    }
}

// ===========================================================================
// OFTCore Trait (exposed as contract entrypoints)
// ===========================================================================

/// Public OFT (Omnichain Fungible Token) interface for cross-chain token transfers.
///
/// `OFTCore` defines the externally callable contract entrypoints for interacting with an
/// OFT deployment. Every method in this trait becomes a Soroban contract function via
/// `#[contract_trait]`. All business logic lives in [`OFTInternal`] — this trait is a
/// thin entrypoint layer that delegates to the internal implementations.
///
/// # Typical Client Workflow
///
/// 1. Call [`quote_oft`](OFTCore::quote_oft) to preview transfer limits, fees, and the
///    estimated receipt (amounts sent vs. received after dust removal and fees).
/// 2. Call [`quote_send`](OFTCore::quote_send) to obtain the LayerZero messaging fee.
/// 3. Call [`send`](OFTCore::send) to execute the cross-chain transfer, supplying the
///    quoted fee and a refund address for any excess.
#[contract_trait(client_name = "OFTClient")]
pub trait OFTCore: OFTInternal {
    /// Returns the address of the underlying SEP-41 token managed by this OFT.
    fn token(env: &soroban_sdk::Env) -> soroban_sdk::Address {
        Self::__token(env)
    }

    /// Returns the OFT messaging protocol version as `(major, minor)`.
    ///
    /// The version is used by off-chain tooling and peer contracts to verify wire-format
    /// compatibility.
    fn oft_version(_env: &soroban_sdk::Env) -> (u64, u64) {
        (1, 1)
    }

    /// Returns the **shared decimals** — the common decimal precision used in cross-chain
    /// messages.
    ///
    /// Token amounts are normalized to this precision before encoding into LayerZero
    /// messages, ensuring consistent values regardless of each chain's native token
    /// decimals. For example, a token with 18 local decimals and 6 shared decimals has a
    /// conversion rate of 10^12.
    fn shared_decimals(env: &soroban_sdk::Env) -> u32 {
        Self::__shared_decimals(env)
    }

    /// Returns the **decimal conversion rate** (`10 ^ (local_decimals - shared_decimals)`).
    ///
    /// This multiplier converts between local-decimal amounts (used on-chain) and
    /// shared-decimal amounts (used in cross-chain messages). Any sub-conversion-rate
    /// remainder ("dust") is stripped before sending to avoid rounding discrepancies
    /// across chains.
    fn decimal_conversion_rate(env: &soroban_sdk::Env) -> i128 {
        Self::__decimal_conversion_rate(env)
    }

    /// Indicates whether the caller must approve a token allowance before calling [`send`](OFTCore::send).
    ///
    /// - **`false`** (default) — no separate approval step is needed.
    /// - **`true`** — the caller must grant a token allowance to this contract before
    ///   sending (e.g., via `token.approve(oft_address, amount, ...)`).
    ///
    /// Wallet and frontend integrators should check this to determine whether an approval
    /// transaction must precede the send.
    fn approval_required(_env: &soroban_sdk::Env) -> bool {
        false
    }

    /// Returns the current message inspector contract address, or `None` if unset.
    ///
    /// When set, the inspector's `inspect` method is invoked during both
    /// [`quote_send`](OFTCore::quote_send) and [`send`](OFTCore::send) to validate the
    /// outgoing message payload and options before they reach the LayerZero endpoint.
    fn msg_inspector(env: &soroban_sdk::Env) -> Option<soroban_sdk::Address> {
        Self::__msg_inspector(env)
    }

    /// Sets or removes the message inspector contract.
    ///
    /// The message inspector is an **optional** validation hook. When configured, every
    /// outbound message (from both `send` and `quote_send`) is passed to the inspector
    /// contract's `inspect(contract, message, options)` method. The inspector should
    /// **panic** to reject invalid messages, acting as an on-chain policy gate.
    ///
    /// Pass `None` to remove the inspector and disable outbound validation.
    ///
    /// # Authorization
    /// Requires the caller to be the authorizer.
    ///
    /// # Arguments
    /// * `inspector` - Address of the inspector contract, or `None` to remove it
    /// * `operator` - The authorizer address
    #[only_role(operator, AUTHORIZER)]
    fn set_msg_inspector(
        env: &soroban_sdk::Env,
        inspector: &Option<soroban_sdk::Address>,
        operator: &soroban_sdk::Address,
    ) {
        Self::__set_msg_inspector(env, inspector);
    }

    /// Previews an OFT transfer **without executing** it.
    ///
    /// Use this to display transfer details to the user before they commit. Returns:
    ///
    /// - **`OFTLimit`** — the minimum and maximum transferable amounts in local decimals.
    /// - **`Vec<OFTFeeDetail>`** — itemized fees (empty by default; populated when custom
    ///   fee logic is implemented via [`OFTInternal::__quote_oft`]).
    /// - **`OFTReceipt`** — estimated `amount_sent_ld` and `amount_received_ld` after
    ///   dust removal and any fees.
    ///
    /// # Arguments
    /// * `from` - The address that would initiate the transfer
    /// * `send_param` - The proposed transfer parameters (destination, amount, options, etc.)
    fn quote_oft(
        env: &soroban_sdk::Env,
        from: &soroban_sdk::Address,
        send_param: &oft_core::SendParam,
    ) -> (oft_core::OFTLimit, soroban_sdk::Vec<oft_core::OFTFeeDetail>, oft_core::OFTReceipt) {
        Self::__quote_oft(env, from, send_param)
    }

    /// Quotes the **LayerZero messaging fee** required for a cross-chain send.
    ///
    /// Builds the outgoing message and options from `send_param`, then queries the
    /// LayerZero endpoint for the corresponding fee. If a message inspector is set, it
    /// will also validate the message at this stage.
    ///
    /// # Arguments
    /// * `from` - The address that would initiate the transfer
    /// * `send_param` - The proposed transfer parameters
    /// * `pay_in_zro` - `true` to pay the messaging fee in the ZRO token; `false` to pay
    ///   in the chain's native token
    ///
    /// # Returns
    /// A [`MessagingFee`](endpoint_v2::MessagingFee) containing the `native_fee` and
    /// `zro_fee` required by the endpoint. Pass this value (or a superset) to
    /// [`send`](OFTCore::send).
    fn quote_send(
        env: &soroban_sdk::Env,
        from: &soroban_sdk::Address,
        send_param: &oft_core::SendParam,
        pay_in_zro: bool,
    ) -> endpoint_v2::MessagingFee {
        Self::__quote_send(env, from, send_param, pay_in_zro)
    }

    /// Executes a cross-chain token transfer via the LayerZero endpoint.
    ///
    /// Builds the OFT message and options, then sends the message through the LayerZero endpoint.
    ///
    /// # Arguments
    /// * `from` - The token sender (must authorize the call)
    /// * `send_param` - Transfer parameters including destination chain (`dst_eid`),
    ///   recipient (`to`), amount, slippage floor (`min_amount_ld`), extra options, and
    ///   an optional compose message
    /// * `fee` - The messaging fee to pay (obtain from [`quote_send`](OFTCore::quote_send))
    /// * `refund_address` - Address to receive any excess fee refund
    ///
    /// # Returns
    /// * [`MessagingReceipt`](endpoint_v2::MessagingReceipt) — the LayerZero message GUID,
    ///   nonce, and fee actually consumed
    /// * [`OFTReceipt`](crate::types::OFTReceipt) — `amount_sent_ld` (debited) and
    ///   `amount_received_ld` (credited on destination after dust removal / fees)
    fn send(
        env: &soroban_sdk::Env,
        from: &soroban_sdk::Address,
        send_param: &oft_core::SendParam,
        fee: &endpoint_v2::MessagingFee,
        refund_address: &soroban_sdk::Address,
    ) -> (endpoint_v2::MessagingReceipt, oft_core::OFTReceipt) {
        Self::__send(env, from, send_param, fee, refund_address)
    }
}

// ===========================================================================
// LzReceive Handler (called by OAppReceiver)
// ===========================================================================

/// Implements `LzReceiveInternal` for an OFT contract using the default OFT receive logic.
///
/// This macro generates the boilerplate `LzReceiveInternal` implementation that delegates
/// to `OFTInternal::__receive`, which handles decoding the OFT message, crediting
/// tokens to the recipient, and optionally queuing compose messages.
///
/// # Usage
///
/// ```ignore
/// use oft_core::impl_oft_lz_receive;
///
/// #[oapp]
/// pub struct MyOFT;
///
/// impl OFTInternal for MyOFT {
///     // ... implement __debit and __credit ...
/// }
///
/// // Instead of manually implementing LzReceiveInternal:
/// impl_oft_lz_receive!(MyOFT);
/// ```
#[macro_export]
macro_rules! impl_oft_lz_receive {
    ($contract:ty) => {
        impl oapp::oapp_receiver::LzReceiveInternal for $contract {
            fn __lz_receive(
                env: &soroban_sdk::Env,
                origin: &endpoint_v2::Origin,
                guid: &soroban_sdk::BytesN<32>,
                message: &soroban_sdk::Bytes,
                extra_data: &soroban_sdk::Bytes,
                executor: &soroban_sdk::Address,
                value: i128,
            ) {
                <Self as oft_core::OFTInternal>::__receive(env, origin, guid, message, extra_data, executor, value)
            }
        }
    };
}

// ===========================================================================
// Helper Functions
// ===========================================================================

/// Asserts that the send amount and min_amount are nonnegative.
/// # Arguments
/// * `env` - The environment
/// * `send_param` - The send parameters to assert
///
/// # Panics
/// * `OFTError::InvalidAmount` - If the send amount or min_amount is negative
pub fn assert_nonnegative_amount(env: &Env, send_param: &SendParam) {
    assert_with_error!(env, send_param.amount_ld >= 0 && send_param.min_amount_ld >= 0, OFTError::InvalidAmount);
}
