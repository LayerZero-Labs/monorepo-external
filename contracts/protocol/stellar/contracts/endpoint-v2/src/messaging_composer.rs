use super::{EndpointV2, EndpointV2Args, EndpointV2Client};
use crate::{
    errors::EndpointError,
    events::{ComposeDelivered, ComposeSent, LzComposeAlert},
    storage::EndpointStorage,
    util::keccak256,
    IMessagingComposer,
};
use common_macros::contract_impl;
use soroban_sdk::{assert_with_error, Address, Bytes, BytesN, Env};

/// Represents a received message hash marker (equivalent to bytes32(uint256(1)) in Solidity)
const RECEIVED_MESSAGE_HASH_BYTES: [u8; 32] =
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];

/// Represents the maximum compose index (equivalent to uint16.max in Solidity)
const MAX_COMPOSE_INDEX: u32 = u16::MAX as u32;

#[contract_impl]
impl IMessagingComposer for EndpointV2 {
    /// Sends a composed message from an OApp to a composer.
    ///
    /// The composer MUST assert the sender because anyone can send compose msg with this function.
    /// With the same GUID, the OApp can send compose to multiple composers at the same time.
    fn send_compose(env: &Env, from: &Address, to: &Address, guid: &BytesN<32>, index: u32, message: &Bytes) {
        from.require_auth();
        assert_compose_index(env, index);

        let compose_queue = Self::compose_queue(env, from, to, guid, index);
        assert_with_error!(env, compose_queue.is_none(), EndpointError::ComposeExists);

        let message_hash = keccak256(env, message);
        EndpointStorage::set_compose_queue(env, from, to, guid, index, &message_hash);
        ComposeSent { from: from.clone(), to: to.clone(), guid: guid.clone(), index, message: message.clone() }
            .publish(env);
    }

    /// Clears a composed message by the composer.
    ///
    /// This is a PULL mode versus the PUSH mode of `lz_compose`.
    fn clear_compose(env: &Env, composer: &Address, from: &Address, guid: &BytesN<32>, index: u32, message: &Bytes) {
        composer.require_auth();
        assert_compose_index(env, index);

        let expected_hash = Self::compose_queue(env, from, composer, guid, index);
        let actual_hash = keccak256(env, message);
        assert_with_error!(env, expected_hash == Some(actual_hash), EndpointError::ComposeNotFound);

        // Marks the message as received to prevent reentrancy.
        // Cannot just delete the value, otherwise the message can be sent again and could result
        // in some undefined behaviour even though the sender (composing OApp) is implicitly fully
        // trusted by the composer. e.g. sender may not even realize it has such a bug.
        let received_hash = BytesN::from_array(env, &RECEIVED_MESSAGE_HASH_BYTES);
        EndpointStorage::set_compose_queue(env, from, composer, guid, index, &received_hash);

        ComposeDelivered { from: from.clone(), to: composer.clone(), guid: guid.clone(), index }.publish(env);
    }

    /// Emits an alert event when `lz_compose` execution fails.
    ///
    /// Called by the executor to notify about failed compose message delivery attempts.
    fn lz_compose_alert(
        env: &Env,
        executor: &Address,
        from: &Address,
        to: &Address,
        guid: &BytesN<32>,
        index: u32,
        gas: i128,
        value: i128,
        message: &Bytes,
        extra_data: &Bytes,
        reason: &Bytes,
    ) {
        executor.require_auth();
        assert_with_error!(env, gas >= 0 && value >= 0, EndpointError::InvalidAmount);
        assert_compose_index(env, index);
        LzComposeAlert {
            executor: executor.clone(),
            from: from.clone(),
            to: to.clone(),
            guid: guid.clone(),
            index,
            gas,
            value,
            message: message.clone(),
            extra_data: extra_data.clone(),
            reason: reason.clone(),
        }
        .publish(env);
    }

    // ============================================================================================
    // View Functions
    // ============================================================================================

    /// Returns the stored hash for a composed message, or `None` if not queued.
    fn compose_queue(env: &Env, from: &Address, to: &Address, guid: &BytesN<32>, index: u32) -> Option<BytesN<32>> {
        EndpointStorage::compose_queue(env, from, to, guid, index)
    }
}

fn assert_compose_index(env: &Env, index: u32) {
    assert_with_error!(env, index <= MAX_COMPOSE_INDEX, EndpointError::InvalidIndex);
}
