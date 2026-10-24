use super::{EndpointV2, EndpointV2Args, EndpointV2Client};
use crate::{
    errors::EndpointError,
    events::{InboundNonceSkipped, PacketBurnt, PacketNilified},
    interfaces::{ILayerZeroEndpointV2, IMessagingChannel},
    storage::EndpointStorage,
    util::{compute_guid, keccak256},
};
use common_macros::contract_impl;
use soroban_sdk::{assert_with_error, Address, Bytes, BytesN, Env, Vec};

/// Represents an empty payload hash (equivalent to bytes32(uint256(0)) in Solidity)
const EMPTY_PAYLOAD_HASH_BYTES: [u8; 32] = [0u8; 32];

/// Represents a nilified payload hash (equivalent to bytes32(type(uint256).max) in Solidity)
const NIL_PAYLOAD_HASH_BYTES: [u8; 32] = [0xffu8; 32];

/// Max number of out-of-order nonces in the pending list.
pub(super) const PENDING_INBOUND_NONCE_MAX_LEN: u64 = 256;

#[contract_impl]
impl IMessagingChannel for EndpointV2 {
    /// Skips the next expected inbound nonce without verifying.
    ///
    /// The nonce to skip must be the next expected nonce.
    fn skip(env: &Env, caller: &Address, receiver: &Address, src_eid: u32, sender: &BytesN<32>, nonce: u64) {
        Self::require_oapp_auth(env, caller, receiver);

        let next_nonce = Self::inbound_nonce(env, receiver, src_eid, sender) + 1;
        assert_with_error!(env, nonce == next_nonce, EndpointError::InvalidNonce);
        Self::insert_and_drain_pending_nonces(env, receiver, src_eid, sender, nonce);

        InboundNonceSkipped { src_eid, sender: sender.clone(), receiver: receiver.clone(), nonce }.publish(env);
    }

    /// Marks a packet as verified, but disallows execution until it is re-verified.
    ///
    /// Requires the payload hash not been executed.
    fn nilify(
        env: &Env,
        caller: &Address,
        receiver: &Address,
        src_eid: u32,
        sender: &BytesN<32>,
        nonce: u64,
        payload_hash: &Option<BytesN<32>>,
    ) {
        Self::require_oapp_auth(env, caller, receiver);

        let cur_payload_hash = Self::inbound_payload_hash(env, receiver, src_eid, sender, nonce);
        let inbound_nonce = Self::inbound_nonce(env, receiver, src_eid, sender);

        assert_with_error!(env, payload_hash == &cur_payload_hash, EndpointError::PayloadHashNotFound);
        assert_with_error!(env, nonce > inbound_nonce || cur_payload_hash.is_some(), EndpointError::InvalidNonce);

        if nonce > inbound_nonce {
            Self::insert_and_drain_pending_nonces(env, receiver, src_eid, sender, nonce);
        }
        EndpointStorage::set_inbound_payload_hash(env, receiver, src_eid, sender, nonce, &Self::nil_payload_hash(env));

        PacketNilified {
            src_eid,
            sender: sender.clone(),
            receiver: receiver.clone(),
            nonce,
            payload_hash: payload_hash.clone(),
        }
        .publish(env);
    }

    /// Marks a nonce as unexecutable and un-verifiable. The nonce can never be re-verified or executed.
    fn burn(
        env: &Env,
        caller: &Address,
        receiver: &Address,
        src_eid: u32,
        sender: &BytesN<32>,
        nonce: u64,
        payload_hash: &BytesN<32>,
    ) {
        Self::require_oapp_auth(env, caller, receiver);

        // Check if current payload hash matches the provided payload hash
        let cur_payload_hash = Self::inbound_payload_hash(env, receiver, src_eid, sender, nonce);
        assert_with_error!(env, cur_payload_hash.as_ref() == Some(payload_hash), EndpointError::PayloadHashNotFound);

        // Check if nonce is at or below the inbound nonce
        let inbound_nonce = Self::inbound_nonce(env, receiver, src_eid, sender);
        assert_with_error!(env, nonce <= inbound_nonce, EndpointError::InvalidNonce);

        // Remove the payload hash from storage
        EndpointStorage::remove_inbound_payload_hash(env, receiver, src_eid, sender, nonce);

        PacketBurnt {
            src_eid,
            sender: sender.clone(),
            receiver: receiver.clone(),
            nonce,
            payload_hash: payload_hash.clone(),
        }
        .publish(env);
    }

    // ============================================================================================
    // View Functions
    // ============================================================================================

    /// Generates the next GUID for an outbound packet.
    fn next_guid(env: &Env, sender: &Address, dst_eid: u32, receiver: &BytesN<32>) -> BytesN<32> {
        let next_nonce = Self::outbound_nonce(env, sender, dst_eid, receiver) + 1;
        compute_guid(env, next_nonce, Self::eid(env), sender, dst_eid, receiver)
    }

    /// Returns the current outbound nonce for a specific destination.
    fn outbound_nonce(env: &Env, sender: &Address, dst_eid: u32, receiver: &BytesN<32>) -> u64 {
        EndpointStorage::outbound_nonce(env, sender, dst_eid, receiver)
    }

    /// Returns the max index of the longest gapless sequence of verified message nonces.
    ///
    /// The uninitialized value is 0. The first nonce is always 1.
    ///
    /// Note: OApp explicitly skipped nonces count as "verified" for these purposes.
    fn inbound_nonce(env: &Env, receiver: &Address, src_eid: u32, sender: &BytesN<32>) -> u64 {
        EndpointStorage::inbound_nonce(env, receiver, src_eid, sender)
    }

    /// Returns the pending inbound nonces for a specific path.
    fn pending_inbound_nonces(env: &Env, receiver: &Address, src_eid: u32, sender: &BytesN<32>) -> Vec<u64> {
        EndpointStorage::pending_inbound_nonces(env, receiver, src_eid, sender)
    }

    /// Returns the payload hash for a specific inbound nonce.
    fn inbound_payload_hash(
        env: &Env,
        receiver: &Address,
        src_eid: u32,
        sender: &BytesN<32>,
        nonce: u64,
    ) -> Option<BytesN<32>> {
        EndpointStorage::inbound_payload_hash(env, receiver, src_eid, sender, nonce)
    }
}

// ============================================================================
// Internal Functions
// ============================================================================

impl EndpointV2 {
    /// Increments the outbound nonce and stores it for a specific path.
    ///
    /// # Returns
    /// * `nonce` - The next nonce for the path
    pub(super) fn outbound(env: &Env, sender: &Address, dst_eid: u32, receiver: &BytesN<32>) -> u64 {
        let nonce = Self::outbound_nonce(env, sender, dst_eid, receiver) + 1;
        EndpointStorage::set_outbound_nonce(env, sender, dst_eid, receiver, &nonce);
        nonce
    }

    /// Records an inbound message payload hash for a specific nonce on a specific path.
    ///
    /// When nonce > inbound_nonce, inserts into the pending list and drains consecutive
    /// nonces to update the effective inbound nonce.
    ///
    /// # Arguments
    /// * `receiver` - The receiver OApp address
    /// * `src_eid` - The source endpoint ID
    /// * `sender` - The sender OApp address on the source chain
    /// * `nonce` - The nonce of the message
    /// * `payload_hash` - The payload hash of the message (must not be empty payload hash)
    pub(super) fn inbound(
        env: &Env,
        receiver: &Address,
        src_eid: u32,
        sender: &BytesN<32>,
        nonce: u64,
        payload_hash: &BytesN<32>,
    ) {
        assert_with_error!(env, payload_hash != &Self::empty_payload_hash(env), EndpointError::InvalidPayloadHash);

        let inbound_nonce = Self::inbound_nonce(env, receiver, src_eid, sender);

        // Only allow to verify new nonces or re-verify unexecuted nonces.
        assert_with_error!(
            env,
            nonce > inbound_nonce || EndpointStorage::has_inbound_payload_hash(env, receiver, src_eid, sender, nonce),
            EndpointError::InvalidNonce
        );

        if nonce > inbound_nonce {
            Self::insert_and_drain_pending_nonces(env, receiver, src_eid, sender, nonce);
        }

        EndpointStorage::set_inbound_payload_hash(env, receiver, src_eid, sender, nonce, payload_hash);
    }

    /// Clears a stored message payload.
    ///
    /// Requires nonce <= inbound_nonce (no iteration, O(1) check). The inbound_nonce
    /// is updated during verify when consecutive nonces are drained from the pending list.
    ///
    /// # Arguments
    /// * `receiver` - The receiver OApp address
    /// * `src_eid` - The source endpoint ID
    /// * `sender` - The sender OApp address on the source chain
    /// * `nonce` - The nonce of the message
    /// * `payload` - The payload of the message
    pub(super) fn clear_payload(
        env: &Env,
        receiver: &Address,
        src_eid: u32,
        sender: &BytesN<32>,
        nonce: u64,
        payload: &Bytes,
    ) {
        let inbound_nonce = Self::inbound_nonce(env, receiver, src_eid, sender);
        assert_with_error!(env, nonce <= inbound_nonce, EndpointError::InvalidNonce);

        // Check the hash of the payload to verify the executor has given the proper payload that has been verified
        let actual_hash = keccak256(env, payload);
        let expected_hash = Self::inbound_payload_hash(env, receiver, src_eid, sender, nonce);
        assert_with_error!(env, Some(actual_hash) == expected_hash, EndpointError::PayloadHashNotFound);

        // Remove it from storage
        EndpointStorage::remove_inbound_payload_hash(env, receiver, src_eid, sender, nonce);
    }

    /// Inserts a nonce into a sorted pending list, then drains consecutive nonces from the front
    /// to advance `inbound_nonce`.
    ///
    /// Bounded by `PENDING_INBOUND_NONCE_MAX_LEN` to prevent DDoS via unbounded list growth.
    fn insert_and_drain_pending_nonces(
        env: &Env,
        receiver: &Address,
        src_eid: u32,
        sender: &BytesN<32>,
        new_nonce: u64,
    ) {
        let inbound_nonce = Self::inbound_nonce(env, receiver, src_eid, sender);
        assert_with_error!(
            env,
            new_nonce > inbound_nonce && new_nonce <= inbound_nonce + PENDING_INBOUND_NONCE_MAX_LEN,
            EndpointError::InvalidNonce
        );

        let mut pending_nonces = Self::pending_inbound_nonces(env, receiver, src_eid, sender);

        // Allow to re-verify at the same nonce and insert the new nonce if it doesn't already exist.
        // When the binary_search returns an error, the nonce is not in the list and should be inserted.
        if let Err(i) = pending_nonces.binary_search(new_nonce) {
            pending_nonces.insert(i, new_nonce);

            // Drain consecutive nonces from the front to advance the inbound nonce
            let mut new_inbound_nonce = inbound_nonce;
            while !pending_nonces.is_empty() && pending_nonces.first_unchecked() == new_inbound_nonce + 1 {
                new_inbound_nonce = pending_nonces.pop_front_unchecked();
            }

            // Update the pending nonces and inbound nonce if needed
            EndpointStorage::set_pending_inbound_nonces(env, receiver, src_eid, sender, &pending_nonces);
            if new_inbound_nonce > inbound_nonce {
                EndpointStorage::set_inbound_nonce(env, receiver, src_eid, sender, &new_inbound_nonce);
            }
        }
    }

    /// Represents an empty payload hash
    fn empty_payload_hash(env: &Env) -> BytesN<32> {
        BytesN::from_array(env, &EMPTY_PAYLOAD_HASH_BYTES)
    }

    /// Represents a nilified payload hash
    fn nil_payload_hash(env: &Env) -> BytesN<32> {
        BytesN::from_array(env, &NIL_PAYLOAD_HASH_BYTES)
    }
}

// ============================================================================
// Test-only Functions
// ============================================================================

#[cfg(test)]
mod test {
    use super::*;

    impl EndpointV2 {
        /// Test-only wrapper for empty_payload_hash.
        pub fn empty_payload_hash_for_test(env: &Env) -> BytesN<32> {
            Self::empty_payload_hash(env)
        }

        /// Test-only wrapper for nil_payload_hash.
        pub fn nil_payload_hash_for_test(env: &Env) -> BytesN<32> {
            Self::nil_payload_hash(env)
        }

        /// Test-only wrapper for outbound.
        pub fn outbound_for_test(env: &Env, sender: &Address, dst_eid: u32, receiver: &BytesN<32>) -> u64 {
            Self::outbound(env, sender, dst_eid, receiver)
        }

        /// Test-only wrapper for inbound.
        pub fn inbound_for_test(
            env: &Env,
            receiver: &Address,
            src_eid: u32,
            sender: &BytesN<32>,
            nonce: u64,
            payload_hash: &BytesN<32>,
        ) {
            Self::inbound(env, receiver, src_eid, sender, nonce, payload_hash)
        }

        /// Test-only wrapper for clear_payload.
        pub fn clear_payload_for_test(
            env: &Env,
            receiver: &Address,
            src_eid: u32,
            sender: &BytesN<32>,
            nonce: u64,
            payload: &Bytes,
        ) {
            Self::clear_payload(env, receiver, src_eid, sender, nonce, payload)
        }

        /// Test-only wrapper for insert_and_drain_pending_nonces.
        pub fn insert_and_drain_pending_nonces_for_test(
            env: &Env,
            receiver: &Address,
            src_eid: u32,
            sender: &BytesN<32>,
            new_nonce: u64,
        ) {
            Self::insert_and_drain_pending_nonces(env, receiver, src_eid, sender, new_nonce)
        }
    }
}
