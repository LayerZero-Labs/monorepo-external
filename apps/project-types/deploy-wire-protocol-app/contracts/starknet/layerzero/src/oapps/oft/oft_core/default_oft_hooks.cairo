//! Default implementation of OFT hooks

use core::num::traits::Zero;
use openzeppelin::token::erc20::ERC20Component;
use starknet::ContractAddress;
use crate::OAppCoreComponent;
use crate::common::constants::DEAD_ADDRESS;
use crate::oapps::oft::oft_core::oft_core::OFTCoreComponent;
use crate::oapps::oft::structs::OFTDebit;

pub impl OFTCoreOFTHooksDefaultImpl<
    TContractState,
    +OAppCoreComponent::HasComponent<TContractState>,
    impl OFTCore: OFTCoreComponent::HasComponent<TContractState>,
    +ERC20Component::ERC20HooksTrait<TContractState>,
    impl ERC20: ERC20Component::HasComponent<TContractState>,
    impl ERC20Internal: ERC20Component::InternalTrait<TContractState>,
    +Drop<TContractState>,
> of OFTCoreComponent::OFTHooks<TContractState> {
    fn _debit(
        ref self: OFTCoreComponent::ComponentState<TContractState>,
        from: ContractAddress,
        amount: u256,
        min_amount: u256,
        dst_eid: u32,
    ) -> OFTDebit {
        let mut contract = self.get_contract_mut();
        let oft_core = OFTCore::get_component(@contract);
        let oft_debit = Self::_debit_view(oft_core, amount, min_amount, dst_eid);

        // Burn tokens from sender
        let mut erc20 = ERC20::get_component_mut(ref contract);
        ERC20Internal::burn(ref erc20, from, oft_debit.amount_sent_ld);

        oft_debit
    }

    fn _credit(
        ref self: OFTCoreComponent::ComponentState<TContractState>,
        to: ContractAddress,
        amount: u256,
        src_eid: u32,
    ) -> u256 {
        // Handle the zero address case
        let recipient = if to.is_zero() {
            DEAD_ADDRESS
        } else {
            to
        };

        // Mint tokens to recipient
        let mut contract = self.get_contract_mut();
        let mut erc20 = ERC20::get_component_mut(ref contract);
        ERC20Internal::mint(ref erc20, recipient, amount);

        // Return the actual amount received (same as input in default implementation)
        amount
    }

    fn _token(self: @OFTCoreComponent::ComponentState<TContractState>) -> ContractAddress {
        starknet::get_contract_address()
    }

    fn _approval_required(self: @OFTCoreComponent::ComponentState<TContractState>) -> bool {
        false
    }
}
