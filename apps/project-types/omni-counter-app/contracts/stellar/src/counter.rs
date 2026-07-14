use crate::{
    codec::{self, MsgType},
    errors::CounterError,
    options,
    storage::CounterStorage,
};
use common_macros::{contract_impl, lz_contract, only_auth};
use endpoint_v2::{
    ILayerZeroComposer, LayerZeroEndpointV2Client, MessagingChannelClient, MessagingComposerClient, MessagingFee,
    Origin,
};
use oapp::{
    oapp_core::{init_ownable_oapp, OAppCore},
    oapp_receiver::{LzReceiveInternal, OAppReceiver},
    oapp_sender::{FeePayer, OAppSenderInternal},
};
use oapp_macros::oapp;
use soroban_sdk::{assert_with_error, panic_with_error, token::TokenClient, Address, Bytes, BytesN, Env};

#[lz_contract]
#[oapp(custom = [receiver])]
pub struct Counter;

#[contract_impl]
impl Counter {
    pub fn __constructor(env: &Env, owner: &Address, endpoint: &Address, delegate: &Address) {
        init_ownable_oapp::<Self>(env, owner, endpoint, delegate);
        let endpoint_client = LayerZeroEndpointV2Client::new(env, endpoint);
        CounterStorage::set_eid(env, &endpoint_client.eid());
    }

    pub fn quote(env: &Env, dst_eid: u32, msg_type: u32, options: &Bytes, pay_in_zro: bool) -> MessagingFee {
        Self::__quote(env, dst_eid, &codec::encode(env, (msg_type as u8).into(), Self::eid(env)), options, pay_in_zro)
    }

    pub fn increment(env: &Env, caller: &Address, dst_eid: u32, msg_type: u32, options: &Bytes, fee: &MessagingFee) {
        caller.require_auth();

        // Increment the outbound count
        let outbound_count = Self::outbound_count(env, dst_eid);
        CounterStorage::set_outbound_count(env, dst_eid, &(outbound_count + 1));

        // Send the message — caller already authorized via require_auth() above
        let message = codec::encode(env, (msg_type as u8).into(), Self::eid(env));
        Self::__lz_send(env, dst_eid, &message, options, &FeePayer::Verified(caller.clone()), fee, caller);
    }

    // ============================================================================================
    // Owner functions
    // ============================================================================================

    #[only_auth]
    pub fn set_ordered_nonce(env: &Env, ordered_nonce: bool) {
        CounterStorage::set_ordered_nonce(env, &ordered_nonce);
    }

    #[only_auth]
    pub fn skip_inbound_nonce(env: &Env, src_eid: u32, sender: &BytesN<32>, nonce: u64) {
        let contract_address = env.current_contract_address();

        let endpoint_address = Self::endpoint(env);
        let endpoint = MessagingChannelClient::new(env, &endpoint_address);
        endpoint.skip(&contract_address, &contract_address, &src_eid, sender, &nonce);

        if CounterStorage::ordered_nonce(env) {
            let max_received_nonce = CounterStorage::max_received_nonce(env, src_eid, sender);
            CounterStorage::set_max_received_nonce(env, src_eid, sender, &(max_received_nonce + 1));
        }
    }

    #[only_auth]
    pub fn withdraw(env: &Env, to: &Address, amount: i128) {
        let native_token = LayerZeroEndpointV2Client::new(env, &Self::endpoint(env)).native_token();
        TokenClient::new(env, &native_token).transfer(&env.current_contract_address(), to, &amount);
    }

    // ============================================================================================
    // View functions
    // ============================================================================================

    pub fn eid(env: &Env) -> u32 {
        CounterStorage::eid(env).unwrap()
    }

    pub fn count(env: &Env) -> u64 {
        CounterStorage::count(env)
    }

    pub fn composed_count(env: &Env) -> u64 {
        CounterStorage::composed_count(env)
    }

    pub fn inbound_count(env: &Env, eid: u32) -> u64 {
        CounterStorage::inbound_count(env, eid)
    }

    pub fn outbound_count(env: &Env, eid: u32) -> u64 {
        CounterStorage::outbound_count(env, eid)
    }

    // ============================================================================================
    // Internal Functions
    // ============================================================================================

    fn __accept_nonce(env: &Env, src_eid: u32, sender: &BytesN<32>, nonce: u64) {
        let current_nonce = CounterStorage::max_received_nonce(env, src_eid, sender);
        if CounterStorage::ordered_nonce(env) {
            assert_with_error!(env, nonce == current_nonce + 1, CounterError::OAppInvalidNonce);
        }
        // Update the max nonce anyway. once the ordered mode is turned on, missing early nonces will be rejected
        if nonce > current_nonce {
            CounterStorage::set_max_received_nonce(env, src_eid, sender, &nonce);
        }
    }
}

// ============================================================================================
// LzReceiveInternal implementation
// ============================================================================================

impl LzReceiveInternal for Counter {
    fn __lz_receive(
        env: &Env,
        origin: &Origin,
        guid: &BytesN<32>,
        message: &Bytes,
        _extra_data: &Bytes,
        _executor: &Address,
        value: i128,
    ) {
        // handle the message
        Self::__accept_nonce(env, origin.src_eid, &origin.sender, origin.nonce);

        let contract_address = env.current_contract_address();

        // Increment the count and inbound count
        let count = Self::count(env);
        let inbound_count = Self::inbound_count(env, origin.src_eid);
        CounterStorage::set_count(env, &(count + 1));
        CounterStorage::set_inbound_count(env, origin.src_eid, &(inbound_count + 1));

        let assert_received_value = || {
            let expected_msg_value = codec::value(env, message);
            assert_with_error!(env, value >= expected_msg_value, CounterError::InsufficientValue);
        };

        match codec::msg_type(message) {
            MsgType::Vanilla => {
                assert_received_value();
            }
            MsgType::Composed | MsgType::ComposedABA => {
                let endpoint: MessagingComposerClient<'_> = MessagingComposerClient::new(env, &Self::endpoint(env));
                endpoint.send_compose(&contract_address, &contract_address, guid, &0, message);
            }
            MsgType::ABA => {
                assert_received_value();

                // Increment the outbound count
                let outbound_count = Self::outbound_count(env, origin.src_eid);
                CounterStorage::set_outbound_count(env, origin.src_eid, &(outbound_count + 1));

                // Send the response message — contract is the fee payer (auto-authorized)
                let options = options::executor_lz_receive_option(env, 200000, 10);
                Self::__lz_send(
                    env,
                    origin.src_eid,
                    &codec::encode_with_value(env, MsgType::Vanilla, Self::eid(env), 10),
                    &options,
                    &FeePayer::Verified(contract_address.clone()),
                    &MessagingFee { native_fee: value, zro_fee: 0 },
                    &contract_address,
                );
            }
        }
    }
}

// ============================================================================================
// Custom OAppReceiver implementation
// ============================================================================================

#[contract_impl(contracttrait)]
impl OAppReceiver for Counter {
    fn next_nonce(env: &Env, src_eid: u32, sender: &BytesN<32>) -> u64 {
        if CounterStorage::ordered_nonce(env) {
            CounterStorage::max_received_nonce(env, src_eid, sender) + 1
        } else {
            0
        }
    }
}

// ============================================================================================
// ILayerZeroComposer implementation
// ============================================================================================

#[contract_impl]
impl ILayerZeroComposer for Counter {
    fn lz_compose(
        env: &Env,
        executor: &Address,
        from: &Address,
        guid: &BytesN<32>,
        index: u32,
        message: &Bytes,
        _extra_data: &Bytes,
        value: i128,
    ) {
        // Clear compose message, transfer value, and require executor auth
        clear_compose_and_transfer::<Self>(env, executor, from, guid, index, message, value);

        let msg_type = codec::msg_type(message);
        if msg_type != MsgType::Composed && msg_type != MsgType::ComposedABA {
            panic_with_error!(env, CounterError::InvalidMsgType);
        }

        // Assert the value is sufficient
        let expected_msg_value = codec::value(env, message);
        assert_with_error!(env, value >= expected_msg_value, CounterError::InsufficientValue);

        // Increment the composed count
        CounterStorage::set_composed_count(env, &(Self::composed_count(env) + 1));

        // Handle ComposedABA: send response message back to source
        if msg_type == MsgType::ComposedABA {
            let src_eid = codec::src_eid(message);

            // Increment the outbound count
            CounterStorage::set_outbound_count(env, src_eid, &(Self::outbound_count(env, src_eid) + 1));

            // Send the response message — contract is the fee payer (auto-authorized)
            let curr_address = env.current_contract_address();
            Self::__lz_send(
                env,
                src_eid,
                &codec::encode(env, MsgType::Vanilla, Self::eid(env)),
                &options::executor_lz_receive_option(env, 200000, 0),
                &FeePayer::Verified(curr_address.clone()),
                &MessagingFee { native_fee: value, zro_fee: 0 },
                &curr_address,
            );
        }
    }
}

/// Clears a compose message and transfers native token value from executor to the OApp.
///
/// This helper handles the common pattern in `lz_compose` implementations:
/// 1. Requires executor authorization
/// 2. Clears the compose message from the endpoint
/// 3. Transfers native token from executor to OApp if value > 0
pub fn clear_compose_and_transfer<T: OAppCore>(
    env: &Env,
    executor: &Address,
    from: &Address,
    guid: &BytesN<32>,
    index: u32,
    message: &Bytes,
    value: i128,
) {
    executor.require_auth();

    let curr_address = env.current_contract_address();
    let endpoint = T::endpoint(env);

    // Clear the compose message
    MessagingComposerClient::new(env, &endpoint).clear_compose(&curr_address, from, guid, &index, message);

    // Transfer value from executor to current contract
    if value > 0 {
        let native_token = LayerZeroEndpointV2Client::new(env, &endpoint).native_token();
        TokenClient::new(env, &native_token).transfer(executor, &curr_address, &value);
    }
}
