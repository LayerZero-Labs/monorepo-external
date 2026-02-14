//! Default implementation of OApp hooks

use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;
use crate::OAppCoreComponent::OAppHooks;
use crate::oapps::oft::oft_core::oft_core::OFTCoreComponent;
use crate::oapps::oft::oft_core::oft_core::OFTCoreComponent::OFTHooks;
use crate::{OAppCoreComponent, Origin};

/// Default implementation of the OApp hooks
pub impl OFTCoreOAppHooksDefaultImpl<
    TContractState,
    +OAppCoreComponent::HasComponent<TContractState>,
    +OFTHooks<TContractState>,
    impl OFTCore: OFTCoreComponent::HasComponent<TContractState>,
    impl OFTCoreInternal: OFTCoreComponent::InternalTrait<TContractState>,
    +Drop<TContractState>,
> of OAppHooks<TContractState> {
    fn _lz_receive(
        ref self: OAppCoreComponent::ComponentState<TContractState>,
        origin: Origin,
        guid: Bytes32,
        message: ByteArray,
        executor: ContractAddress,
        extra_data: ByteArray,
        value: u256,
    ) {
        let mut contract = self.get_contract_mut();
        let mut oft_core = OFTCore::get_component_mut(ref contract);

        OFTCoreInternal::_lz_receive(
            ref oft_core, origin, guid, message, executor, extra_data, value,
        );
    }
}
