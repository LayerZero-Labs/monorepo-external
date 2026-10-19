//! LayerZeroView contract - unified view interface for querying protocol state.
//!
//! This contract provides view functions for:
//! - Endpoint view functions (initializable, verifiable, executable)
//! - ULN302 view functions (verification state with DVN checks)

use crate::{
    storage::LayerZeroViewStorage,
    types::{empty_payload_hash, nil_payload_hash, ExecutionState, VerificationState},
    LayerZeroViewError,
};
use common_macros::{contract_impl, lz_contract};
use endpoint_v2::{LayerZeroEndpointV2Client, MessageLibManagerClient, MessagingChannelClient, Origin};
use message_lib_common::packet_codec_v1::{decode_packet_header, PacketHeader};
use soroban_sdk::{address_payload::AddressPayload, assert_with_error, Address, Bytes, BytesN, Env};
use uln302::ReceiveUln302Client;

#[lz_contract(upgradeable(no_migration))]
pub struct LayerZeroView;

#[contract_impl]
impl LayerZeroView {
    pub fn __constructor(env: &Env, owner: &Address, endpoint: &Address, uln302: &Address) {
        Self::init_owner(env, owner);
        LayerZeroViewStorage::set_endpoint(env, endpoint);
        LayerZeroViewStorage::set_uln302(env, uln302);

        // Cache the local endpoint ID for efficiency
        let endpoint_client = LayerZeroEndpointV2Client::new(env, endpoint);
        let local_eid = endpoint_client.eid();
        LayerZeroViewStorage::set_local_eid(env, &local_eid);
    }

    // =========================================================================
    // Storage Accessors
    // =========================================================================

    /// Returns the endpoint address.
    pub fn endpoint(env: &Env) -> Address {
        LayerZeroViewStorage::endpoint(env).unwrap()
    }

    /// Returns the Uln302 address.
    pub fn uln302(env: &Env) -> Address {
        LayerZeroViewStorage::uln302(env).unwrap()
    }

    /// Returns the local endpoint ID.
    pub fn local_eid(env: &Env) -> u32 {
        LayerZeroViewStorage::local_eid(env).unwrap()
    }

    // =========================================================================
    // Endpoint View Functions
    // =========================================================================

    /// Checks if a messaging path can be initialized for the given origin and receiver.
    pub fn initializable(env: &Env, origin: &Origin, receiver: &Address) -> bool {
        LayerZeroEndpointV2Client::new(env, &Self::endpoint(env)).initializable(origin, receiver)
    }

    /// Checks if a message can be verified at the endpoint.
    ///
    /// Verifies:
    /// 1. Receive library is valid for this receiver and source
    /// 2. Endpoint nonce check passes
    /// 3. Payload hash is not empty
    pub fn verifiable(
        env: &Env,
        origin: &Origin,
        receiver: &Address,
        receive_lib: &Address,
        payload_hash: &BytesN<32>,
    ) -> bool {
        let endpoint_address = Self::endpoint(env);
        let endpoint = LayerZeroEndpointV2Client::new(env, &endpoint_address);
        let msglib_manager = MessageLibManagerClient::new(env, &endpoint_address);

        // Check if receive library is valid for this receiver and source
        if !msglib_manager.is_valid_receive_library(receiver, &origin.src_eid, receive_lib) {
            return false;
        }

        // Check if endpoint says it's verifiable
        if !endpoint.verifiable(origin, receiver) {
            return false;
        }

        // Empty payload hash is not allowed for verification
        if payload_hash == &empty_payload_hash(env) {
            return false;
        }

        true
    }

    /// Returns the execution state of a message.
    pub fn executable(env: &Env, origin: &Origin, receiver: &Address) -> ExecutionState {
        let messaging_channel = MessagingChannelClient::new(env, &Self::endpoint(env));

        let payload_hash =
            messaging_channel.inbound_payload_hash(receiver, &origin.src_eid, &origin.sender, &origin.nonce);

        let empty_hash = empty_payload_hash(env);
        let nil_hash = nil_payload_hash(env);

        // Executed: payload hash has been cleared (None) and nonce <= inbound_nonce
        if payload_hash.is_none()
            && origin.nonce <= messaging_channel.inbound_nonce(receiver, &origin.src_eid, &origin.sender)
        {
            return ExecutionState::Executed;
        }

        // Executable: nonce has not been executed, not nilified, and nonce <= inbound_nonce
        if let Some(ref hash) = payload_hash {
            if hash != &nil_hash
                && origin.nonce <= messaging_channel.inbound_nonce(receiver, &origin.src_eid, &origin.sender)
            {
                return ExecutionState::Executable;
            }
        }

        // VerifiedButNotExecutable: payload hash exists but is not empty or nil
        if let Some(ref hash) = payload_hash {
            if hash != &empty_hash && hash != &nil_hash {
                return ExecutionState::VerifiedButNotExecutable;
            }
        }

        // Default: NotExecutable
        ExecutionState::NotExecutable
    }

    // =========================================================================
    // ULN302 View Functions
    // =========================================================================

    /// Returns the combined verification state of a message.
    ///
    /// This function checks:
    /// 1. Packet header validity (dst_eid matches local_eid)
    /// 2. Endpoint initializable status
    /// 3. Endpoint verifiable status
    /// 4. ULN verifiable status (DVN confirmations)
    pub fn uln_verifiable(env: &Env, packet_header: &Bytes, payload_hash: &BytesN<32>) -> VerificationState {
        // Decode and validate header
        let header: PacketHeader = decode_packet_header(env, packet_header);
        assert_with_error!(env, header.dst_eid == Self::local_eid(env), LayerZeroViewError::InvalidEID);

        // Extract receiver address from header
        let receiver = Address::from_payload(env, AddressPayload::ContractIdHash(header.receiver.clone()));

        // Build Origin from header
        let origin = Origin { src_eid: header.src_eid, sender: header.sender.clone(), nonce: header.nonce };

        // Check endpoint initializable
        let endpoint = LayerZeroEndpointV2Client::new(env, &Self::endpoint(env));

        if !endpoint.initializable(&origin, &receiver) {
            return VerificationState::NotInitializable;
        }

        // Check endpoint verifiable - if false, message is already verified
        let uln302_address = Self::uln302(env);
        if !Self::__endpoint_verifiable(env, &origin, &receiver, &uln302_address, payload_hash) {
            return VerificationState::Verified;
        }

        // Check ULN verifiable (DVN confirmations)
        let uln302 = ReceiveUln302Client::new(env, &uln302_address);
        if uln302.verifiable(packet_header, payload_hash) {
            return VerificationState::Verifiable;
        }

        // Still waiting for DVN verifications
        VerificationState::Verifying
    }
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

impl LayerZeroView {
    /// Checks if the message can be verified at the endpoint for ULN verification.
    ///
    /// This matches EVM's `_endpointVerifiable` which:
    /// 1. Calls `verifiable(origin, receiver, receiveUln302, payloadHash)`
    /// 2. Checks if the payload hash has already been verified
    fn __endpoint_verifiable(
        env: &Env,
        origin: &Origin,
        receiver: &Address,
        uln302: &Address,
        payload_hash: &BytesN<32>,
    ) -> bool {
        // Check verifiable
        if !Self::verifiable(env, origin, receiver, uln302, payload_hash) {
            return false;
        }

        // Check if payload hash has already been verified
        let messaging_channel = MessagingChannelClient::new(env, &Self::endpoint(env));
        let existing_hash =
            messaging_channel.inbound_payload_hash(receiver, &origin.src_eid, &origin.sender, &origin.nonce);

        if existing_hash.as_ref() == Some(payload_hash) {
            return false; // Already verified with this payload hash
        }

        true
    }
}
