use crate::{
    endpoint_v2::messaging_channel::PENDING_INBOUND_NONCE_MAX_LEN,
    errors::EndpointError,
    events::{DelegateSet, LzReceiveAlert, PacketDelivered, PacketSent, PacketVerified, ZroSet},
    interfaces::{ILayerZeroEndpointV2, IMessageLibManager, IMessagingChannel, MessagingFee, MessagingReceipt, Origin},
    storage::EndpointStorage,
    util::{build_payload, compute_guid},
    FeeRecipient, FeesAndPacket, LayerZeroReceiverClient, MessagingParams, OutboundPacket, ResolvedLibrary,
    SendLibClient,
};
use common_macros::{contract_impl, lz_contract, only_auth};
use soroban_sdk::{assert_with_error, token::TokenClient, Address, Bytes, BytesN, Env, Vec};
use utils::option_ext::OptionExt;

#[lz_contract]
pub struct EndpointV2;

#[contract_impl]
impl EndpointV2 {
    pub fn __constructor(env: &Env, owner: &Address, eid: u32, native_token: &Address) {
        Self::init_owner(env, owner);
        EndpointStorage::set_eid(env, &eid);
        EndpointStorage::set_native_token(env, native_token);
    }

    /// Recovers tokens sent to this contract by mistake.
    ///
    /// # Arguments
    /// * `token` - The token address to recover
    /// * `to` - The address to send the token to
    /// * `amount` - The amount to send
    #[only_auth]
    pub fn recover_token(env: &Env, token: &Address, to: &Address, amount: i128) {
        TokenClient::new(env, token).transfer(&env.current_contract_address(), to, &amount);
    }
}

// ============================================================================
// ILayerZeroEndpointV2 Implementation
// ============================================================================

#[contract_impl]
impl ILayerZeroEndpointV2 for EndpointV2 {
    /// Quotes the messaging fee for sending a cross-chain message.
    fn quote(env: &Env, sender: &Address, params: &MessagingParams) -> MessagingFee {
        assert_with_error!(env, !params.pay_in_zro || EndpointStorage::has_zro(env), EndpointError::ZroUnavailable);

        let MessagingParams { dst_eid, receiver, message, options, pay_in_zro } = params;
        let ResolvedLibrary { lib: send_lib, .. } = Self::get_send_library(env, sender, *dst_eid);

        let nonce = Self::outbound_nonce(env, sender, *dst_eid, receiver) + 1;
        let packet = Self::build_outbound_packet(env, sender, *dst_eid, receiver, message, nonce);

        let fee = SendLibClient::new(env, &send_lib).quote(&packet, options, pay_in_zro);
        assert_with_error!(env, fee.native_fee >= 0 && fee.zro_fee >= 0, EndpointError::InvalidAmount);

        fee
    }

    /// Sends a cross-chain message to a destination endpoint.
    ///
    /// OApp sender needs to transfer the fees to the endpoint before sending the message
    fn send(env: &Env, sender: &Address, params: &MessagingParams, refund_address: &Address) -> MessagingReceipt {
        sender.require_auth();
        assert_with_error!(env, !params.pay_in_zro || EndpointStorage::has_zro(env), EndpointError::ZroUnavailable);

        let MessagingParams { dst_eid, receiver, message, options, pay_in_zro } = params;
        let ResolvedLibrary { lib: send_library, .. } = Self::get_send_library(env, sender, *dst_eid);

        // Send outbound packet
        let nonce = Self::outbound(env, sender, *dst_eid, receiver);
        let packet = Self::build_outbound_packet(env, sender, *dst_eid, receiver, message, nonce);

        let FeesAndPacket { native_fee_recipients, zro_fee_recipients, encoded_packet } =
            SendLibClient::new(env, &send_library).send(&packet, options, pay_in_zro);

        // Pay and refund messaging fees
        let fee =
            Self::pay_messaging_fees(env, *pay_in_zro, &native_fee_recipients, &zro_fee_recipients, refund_address);

        // Publish PacketSent event
        PacketSent { encoded_packet, options: options.clone(), send_library }.publish(env);

        MessagingReceipt { guid: packet.guid, nonce, fee }
    }

    /// Verifies an inbound cross-chain message from a configured receive library.
    fn verify(env: &Env, receive_lib: &Address, origin: &Origin, receiver: &Address, payload_hash: &BytesN<32>) {
        receive_lib.require_auth();
        assert_with_error!(
            env,
            Self::is_valid_receive_library(env, receiver, origin.src_eid, receive_lib),
            EndpointError::InvalidReceiveLibrary
        );
        assert_with_error!(env, Self::initializable(env, origin, receiver), EndpointError::PathNotInitializable);
        assert_with_error!(env, Self::verifiable(env, origin, receiver), EndpointError::PathNotVerifiable);

        Self::inbound(env, receiver, origin.src_eid, &origin.sender, origin.nonce, payload_hash);
        PacketVerified { origin: origin.clone(), receiver: receiver.clone(), payload_hash: payload_hash.clone() }
            .publish(env);
    }

    /// Clears a verified message from the endpoint.
    ///
    /// This is a PULL mode versus the PUSH mode of `lz_receive`.
    fn clear(env: &Env, caller: &Address, origin: &Origin, receiver: &Address, guid: &BytesN<32>, message: &Bytes) {
        Self::require_oapp_auth(env, caller, receiver);

        let payload = build_payload(env, guid, message);
        Self::clear_payload(env, receiver, origin.src_eid, &origin.sender, origin.nonce, &payload);
        PacketDelivered { origin: origin.clone(), receiver: receiver.clone() }.publish(env);
    }

    /// Emits an alert event when `lz_receive` execution fails.
    ///
    /// Called by the executor to notify about failed message delivery attempts.
    fn lz_receive_alert(
        env: &Env,
        executor: &Address,
        origin: &Origin,
        receiver: &Address,
        guid: &BytesN<32>,
        gas: i128,
        value: i128,
        message: &Bytes,
        extra_data: &Bytes,
        reason: &Bytes,
    ) {
        executor.require_auth();
        assert_with_error!(env, gas >= 0 && value >= 0, EndpointError::InvalidAmount);
        LzReceiveAlert {
            receiver: receiver.clone(),
            executor: executor.clone(),
            origin: origin.clone(),
            guid: guid.clone(),
            gas,
            value,
            message: message.clone(),
            extra_data: extra_data.clone(),
            reason: reason.clone(),
        }
        .publish(env);
    }

    /// Sets the ZRO token address for fee payments.
    #[only_auth]
    fn set_zro(env: &Env, zro: &Address) {
        EndpointStorage::set_zro(env, zro);
        ZroSet { zro: zro.clone() }.publish(env);
    }

    /// Sets or removes a delegate address that can act on behalf of the OApp.
    fn set_delegate(env: &Env, oapp: &Address, new_delegate: &Option<Address>) {
        oapp.require_auth();
        EndpointStorage::set_or_remove_delegate(env, oapp, new_delegate);
        DelegateSet { oapp: oapp.clone(), delegate: new_delegate.clone() }.publish(env);
    }

    // ============================================================================================
    // View Functions
    // ============================================================================================

    /// Returns the endpoint ID.
    fn eid(env: &Env) -> u32 {
        EndpointStorage::eid(env).unwrap()
    }

    /// Checks if a messaging path can be/has been initialized for the given origin and receiver.
    fn initializable(env: &Env, origin: &Origin, receiver: &Address) -> bool {
        let inbound_nonce = Self::inbound_nonce(env, receiver, origin.src_eid, &origin.sender);
        inbound_nonce > 0 || LayerZeroReceiverClient::new(env, receiver).allow_initialize_path(origin)
    }

    /// Checks if a message can be verified for the given origin and receiver.
    fn verifiable(env: &Env, origin: &Origin, receiver: &Address) -> bool {
        let inbound_nonce = Self::inbound_nonce(env, receiver, origin.src_eid, &origin.sender);
        (origin.nonce > inbound_nonce && origin.nonce <= inbound_nonce + PENDING_INBOUND_NONCE_MAX_LEN)
            || EndpointStorage::has_inbound_payload_hash(env, receiver, origin.src_eid, &origin.sender, origin.nonce)
    }

    /// Returns the native token address used for fee payments.
    fn native_token(env: &Env) -> Address {
        EndpointStorage::native_token(env).unwrap()
    }

    /// Returns the ZRO token address if set.
    fn zro(env: &Env) -> Option<Address> {
        EndpointStorage::zro(env)
    }

    /// Returns the delegate address for an OApp if set.
    fn delegate(env: &Env, oapp: &Address) -> Option<Address> {
        EndpointStorage::delegate(env, oapp)
    }
}

// ============================================================================================
// Internal Functions
// ============================================================================================

impl EndpointV2 {
    /// Builds an outbound packet with the given parameters.
    fn build_outbound_packet(
        env: &Env,
        sender: &Address,
        dst_eid: u32,
        receiver: &BytesN<32>,
        message: &Bytes,
        nonce: u64,
    ) -> OutboundPacket {
        let src_eid = Self::eid(env);
        let guid = compute_guid(env, nonce, src_eid, sender, dst_eid, receiver);
        OutboundPacket {
            nonce,
            src_eid,
            sender: sender.clone(),
            dst_eid,
            receiver: receiver.clone(),
            guid,
            message: message.clone(),
        }
    }

    /// Requires authorization from either the OApp itself or its delegate.
    fn require_oapp_auth(env: &Env, caller: &Address, oapp: &Address) {
        assert_with_error!(
            env,
            caller == oapp || Self::delegate(env, oapp).as_ref() == Some(caller),
            EndpointError::Unauthorized
        );
        caller.require_auth();
    }

    /// Distributes messaging fees to recipients and refunds any excess to the refund address.
    ///
    /// # Arguments
    /// * `pay_in_zro` - Whether to pay in ZRO token
    /// * `native_fee_recipients` - The recipients addresses and amounts of the native fees
    /// * `zro_fee_recipients` - The recipients addresses and amounts of the ZRO fees
    /// * `refund_address` - The address to receive any excess fee refunds
    ///
    /// # Returns
    /// The total `MessagingFee` paid (native_fee + zro_fee)
    fn pay_messaging_fees(
        env: &Env,
        pay_in_zro: bool,
        native_fee_recipients: &Vec<FeeRecipient>,
        zro_fee_recipients: &Vec<FeeRecipient>,
        refund_address: &Address,
    ) -> MessagingFee {
        let this_contract = env.current_contract_address();
        let mut fee_paid = MessagingFee { native_fee: 0, zro_fee: 0 };

        // Pay native fees
        let native_token_client = TokenClient::new(env, &Self::native_token(env));
        let mut native_fee_supplied = native_token_client.balance(&this_contract);
        native_fee_recipients.iter().for_each(|r| {
            // Fee amounts are modeled as non-negative values. The field type is i128 for
            // compatibility with token APIs, but negative fees are always invalid and rejected
            // here, while zero amounts are treated as a no-op (skipped by the check below).
            assert_with_error!(env, r.amount >= 0, EndpointError::InvalidAmount);
            if r.amount > 0 {
                assert_with_error!(env, native_fee_supplied >= r.amount, EndpointError::InsufficientNativeFee);
                native_fee_supplied -= r.amount;
                fee_paid.native_fee += r.amount;
                native_token_client.transfer(&this_contract, &r.to, &r.amount);
            }
        });
        // Refund remaining native fees
        if native_fee_supplied > 0 {
            native_token_client.transfer(&this_contract, refund_address, &native_fee_supplied);
        }

        // Pay ZRO fees
        if pay_in_zro {
            let zro_addr = Self::zro(env).unwrap_or_panic(env, EndpointError::ZroUnavailable);
            let zro_client = TokenClient::new(env, &zro_addr);

            // If pay_in_zro is true, the supplied fee must be greater than 0 to prevent a race condition
            // in which an OApp sending a message with ZRO token and the ZRO token is set to a new token between the tx
            // being sent and the tx being mined. if the required zro fee is 0 and the old zro token would be
            // locked in the contract instead of being refunded
            let mut zro_fee_supplied = zro_client.balance(&this_contract);
            assert_with_error!(env, zro_fee_supplied > 0, EndpointError::ZeroZroFee);

            zro_fee_recipients.iter().for_each(|r| {
                // Fee amounts are modeled as non-negative values. The field type is i128 for
                // compatibility with token APIs, but negative fees are always invalid and rejected
                // here, while zero amounts are treated as a no-op (skipped by the check below).
                assert_with_error!(env, r.amount >= 0, EndpointError::InvalidAmount);
                if r.amount > 0 {
                    assert_with_error!(env, zro_fee_supplied >= r.amount, EndpointError::InsufficientZroFee);
                    zro_fee_supplied -= r.amount;
                    fee_paid.zro_fee += r.amount;
                    zro_client.transfer(&this_contract, &r.to, &r.amount);
                }
            });
            // Refund remaining ZRO fees
            if zro_fee_supplied > 0 {
                zro_client.transfer(&this_contract, refund_address, &zro_fee_supplied);
            }
        }

        fee_paid
    }
}

#[path = "message_lib_manager.rs"]
mod message_lib_manager;
#[path = "messaging_channel.rs"]
mod messaging_channel;
#[path = "messaging_composer.rs"]
mod messaging_composer;

// ============================================================================
// Test-only Functions
// ============================================================================

#[cfg(test)]
mod test {
    use super::*;

    impl EndpointV2 {
        /// Test-only wrapper for build_outbound_packet to enable testing.
        pub fn build_outbound_packet_for_test(
            env: &Env,
            sender: &Address,
            dst_eid: u32,
            receiver: &BytesN<32>,
            message: &Bytes,
            nonce: u64,
        ) -> OutboundPacket {
            Self::build_outbound_packet(env, sender, dst_eid, receiver, message, nonce)
        }

        /// Test-only wrapper for require_oapp_auth.
        pub fn require_oapp_auth_for_test(env: &Env, caller: &Address, oapp: &Address) {
            Self::require_oapp_auth(env, caller, oapp)
        }

        /// Test-only wrapper for pay_messaging_fees.
        pub fn pay_messaging_fees_for_test(
            env: &Env,
            pay_in_zro: bool,
            native_fee_recipients: &Vec<FeeRecipient>,
            zro_fee_recipients: &Vec<FeeRecipient>,
            refund_address: &Address,
        ) -> MessagingFee {
            Self::pay_messaging_fees(env, pay_in_zro, native_fee_recipients, zro_fee_recipients, refund_address)
        }
    }
}
