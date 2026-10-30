// use crate::mocks::messaging_channel::interface::IMockMessagingChannelSafeDispatcherTrait;
use layerzero::Origin;
//! Message lib manager test utils
use layerzero::endpoint::messaging_channel::interface::IMessagingChannelSafeDispatcher;
use layerzero::endpoint::messaging_channel::interface::{
    IMessagingChannelDispatcher, IMessagingChannelDispatcherTrait,
};
use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
use lz_utils::bytes::Bytes32;
use lz_utils::keccak::keccak256;
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};
use starknet::{ContractAddress, SyscallResultTrait};
use crate::mocks::messaging_channel::interface::{
    IMockMessagingChannelDispatcher, IMockMessagingChannelDispatcherTrait,
    IMockMessagingChannelSafeDispatcher,
};

// Constants
pub(crate) const TEN_GWEI: u64 = 10_000_000_000;

/// Messaging channel mock for testing
pub(crate) struct MessagingChannelMock {
    pub messaging_channel: ContractAddress,
    pub dispatcher: IMessagingChannelDispatcher,
    pub safe_dispatcher: IMessagingChannelSafeDispatcher,
    pub helper_dispatcher: IMockMessagingChannelDispatcher,
    pub helper_safe_dispatcher: IMockMessagingChannelSafeDispatcher,
}


/// Deploy the messaging channel contract and return the messaging channel mock
pub(crate) fn deploy_messaging_channel(eid: u32) -> MessagingChannelMock {
    let contract = declare("MockMessagingChannel").unwrap_syscall().contract_class();
    let constructor_args = array![eid.into()];
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap_syscall();

    MessagingChannelMock {
        messaging_channel: contract_address,
        dispatcher: IMessagingChannelDispatcher { contract_address },
        safe_dispatcher: IMessagingChannelSafeDispatcher { contract_address },
        helper_dispatcher: IMockMessagingChannelDispatcher { contract_address },
        helper_safe_dispatcher: IMockMessagingChannelSafeDispatcher { contract_address },
    }
}

// Controls initial inbound state.
// - executed_until: all nonces [1..=executed_until] will be executed (cleared)
// - committed_until: all nonces (executed_until..=committed_until) will be verified (committed)
// Invariant: executed_until <= committed_until
#[derive(Copy, Drop, Debug, Serde)]
pub struct InboundSetupParams {
    pub executed_until: u64,
    pub committed_until: u64,
}

// Deterministic payload builder so keccak(payload) matches what we commit
pub(crate) fn _build_payload(eid: u32, sender: Bytes32, nonce: u64) -> ByteArray {
    let mut p: ByteArray = Default::default();
    p.append_u32(eid);
    p.append_u256(sender.value);
    p.append_u64(nonce);
    p
}


// Deploys a fresh mock and pre-populates inbound state.
// Returns the same `MessagingChannelMock` you’re used to.
pub(crate) fn setup_inbound_state(
    eid: u32, oapp: ContractAddress, sender: Bytes32, params: InboundSetupParams,
) -> MessagingChannelMock {
    let mock = deploy_messaging_channel(eid);
    let helper_dispatcher = IMockMessagingChannelDispatcher {
        contract_address: mock.messaging_channel,
    };
    let dispatcher = IMessagingChannelDispatcher { contract_address: mock.messaging_channel };

    let InboundSetupParams { executed_until, committed_until } = params;

    // 1) Commit [1..=committed_until] so they are considered verified
    for i in 1..=committed_until {
        let payload = _build_payload(eid, sender, i);
        let payload_hash = keccak256(@payload);
        let origin = Origin { src_eid: eid, sender, nonce: i };
        helper_dispatcher.fake_commit(oapp, origin.clone(), payload_hash);
        // clear payloads up to executed_until
        if i <= executed_until {
            helper_dispatcher.test_clear_payload(oapp, origin, payload);
        }
    }

    // 3) Optional sanity: inbound_nonce should equal committed_until
    let inbound = dispatcher.inbound_nonce(oapp, eid, sender);
    assert(inbound == committed_until, 'bad inbound');

    mock
}
