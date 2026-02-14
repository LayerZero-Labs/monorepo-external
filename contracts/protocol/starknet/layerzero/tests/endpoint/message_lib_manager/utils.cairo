//! Message lib manager test utils

use layerzero::endpoint::message_lib_manager::interface::{
    IMessageLibManagerDispatcher, IMessageLibManagerSafeDispatcher,
};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};
use starknet::{ContractAddress, SyscallResultTrait};

// Constants
pub(crate) const TEN_GWEI: u64 = 10_000_000_000;

/// Message lib manager mock for testing
pub(crate) struct MessageLibManagerMock {
    pub message_lib_manager: ContractAddress,
    pub dispatcher: IMessageLibManagerDispatcher,
    pub safe_dispatcher: IMessageLibManagerSafeDispatcher,
}


pub(crate) fn deploy_blocked_message_lib() -> ContractAddress {
    let contract = declare("BlockedMessageLib").unwrap_syscall().contract_class();
    let (contract_address, _) = contract.deploy(@array![]).unwrap_syscall();
    contract_address
}

pub(crate) fn deploy_erc20_mock() -> ContractAddress {
    let contract = declare("MockERC20").unwrap_syscall().contract_class();
    let (contract_address, _) = contract.deploy(@array![]).unwrap_syscall();
    contract_address
}

/// Deploy the message lib manager contract and return the message lib manager mock
pub(crate) fn deploy_message_lib_manager(owner: ContractAddress) -> MessageLibManagerMock {
    let blocked_library = deploy_blocked_message_lib();

    let contract = declare("MockMessageLibManager").unwrap_syscall().contract_class();
    let constructor_args = array![owner.into(), blocked_library.into()];
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap_syscall();

    MessageLibManagerMock {
        message_lib_manager: contract_address,
        dispatcher: IMessageLibManagerDispatcher { contract_address },
        safe_dispatcher: IMessageLibManagerSafeDispatcher { contract_address },
    }
}
