//! Messaging composer test utils

use layerzero::endpoint::messaging_composer::interface::{
    IMessagingComposerDispatcher, IMessagingComposerSafeDispatcher,
};
use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::{ContractAddress, SyscallResultTrait};
use crate::mocks::composer_target::MockComposerTarget::IMockComposerTargetInspectDispatcher;
use crate::mocks::erc20::interface::{IMockERC20Dispatcher, IMockERC20DispatcherTrait};

pub(crate) struct MessagingComposerMock {
    pub messaging_composer: ContractAddress,
    pub dispatcher: IMessagingComposerDispatcher,
    pub safe_dispatcher: IMessagingComposerSafeDispatcher,
    pub token_dispatcher: IERC20Dispatcher,
    pub target_address: ContractAddress,
    pub target_inspect: IMockComposerTargetInspectDispatcher,
}

pub(crate) fn deploy_mock_erc20() -> (IERC20Dispatcher, ContractAddress) {
    let contract = declare("MockERC20").unwrap_syscall().contract_class();
    let initial_supply: u256 = 1_000_000_000_000_000_000_u256;
    let recipient: ContractAddress = 0x111.try_into().unwrap();
    let mut calldata = array![];
    initial_supply.serialize(ref calldata);
    recipient.serialize(ref calldata);
    let (contract_address, _) = contract.deploy(@calldata).unwrap_syscall();
    (IERC20Dispatcher { contract_address }, contract_address)
}

pub(crate) fn deploy_messaging_composer() -> MessagingComposerMock {
    let (token_dispatcher, token_address) = deploy_mock_erc20();

    // Deploy a mock composer target to receive lz_compose calls, though tests can also mock it.
    let target = declare("MockComposerTarget").unwrap_syscall().contract_class();
    let (target_address, _) = target.deploy(@array![]).unwrap_syscall();

    let contract = declare("MockMessagingComposer").unwrap_syscall().contract_class();
    let constructor_args = array![token_address.into()];
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap_syscall();

    MessagingComposerMock {
        messaging_composer: contract_address,
        dispatcher: IMessagingComposerDispatcher { contract_address },
        safe_dispatcher: IMessagingComposerSafeDispatcher { contract_address },
        token_dispatcher,
        target_address,
        target_inspect: IMockComposerTargetInspectDispatcher { contract_address: target_address },
    }
}

/// Mint `amount` tokens to `executor` and approve `spender` to spend `amount` from `executor`.
///
/// This helper mirrors the repeated test setup where the executor funds itself and
/// grants allowance to the messaging composer before calling `lz_compose`.
pub(crate) fn mint_and_approve_for_executor(
    token_dispatcher: IERC20Dispatcher,
    executor: ContractAddress,
    spender: ContractAddress,
    amount: u256,
) {
    let mock_token = IMockERC20Dispatcher { contract_address: token_dispatcher.contract_address };
    start_cheat_caller_address(mock_token.contract_address, executor);
    mock_token.mint(executor, amount);
    stop_cheat_caller_address(mock_token.contract_address);

    start_cheat_caller_address(token_dispatcher.contract_address, executor);
    token_dispatcher.approve(spender, amount);
    stop_cheat_caller_address(token_dispatcher.contract_address);
}

