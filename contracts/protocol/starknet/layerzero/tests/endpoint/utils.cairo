//! EndpointV2 test utils

use layerzero::common::constants::ZERO_ADDRESS;
use layerzero::endpoint::interfaces::endpoint_v2::{
    IEndpointV2Dispatcher, IEndpointV2SafeDispatcher,
};
use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20SafeDispatcher};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};
use starknet::{ContractAddress, SyscallResultTrait};
use crate::e2e::utils::deploy_blocked_message_lib;
use crate::mocks::messaging_composer::MockMessagingComposer::MockMessagingComposerHelpersDispatcher;

const INITIAL_SUPPLY: u256 = 100_000_000;

/// Mock ERC20 for testing
pub(crate) struct ERC20Mock {
    pub token: ContractAddress,
    pub dispatcher: IERC20Dispatcher,
    pub safe_dispatcher: IERC20SafeDispatcher,
    pub initial_supply: u256,
}

/// EndpointV2 for testing
pub(crate) struct EndpointV2Mock {
    pub endpoint: ContractAddress,
    pub dispatcher: IEndpointV2Dispatcher,
    pub safe_dispatcher: IEndpointV2SafeDispatcher,
    pub token: ContractAddress,
    pub token_dispatcher: IERC20Dispatcher,
    pub safe_token_dispatcher: IERC20SafeDispatcher,
}

/// Deploy a mock ERC20 token for testing
pub(crate) fn deploy_mock_erc20(initial_supply: u256, owner: ContractAddress) -> ERC20Mock {
    let contract = declare("MockERC20").unwrap_syscall().contract_class();
    let calldata = array![initial_supply.low.into(), initial_supply.high.into(), owner.into()];
    let (contract_address, _) = contract.deploy(@calldata).unwrap_syscall();

    ERC20Mock {
        token: contract_address,
        dispatcher: IERC20Dispatcher { contract_address },
        safe_dispatcher: IERC20SafeDispatcher { contract_address },
        initial_supply,
    }
}

/// Deploy a mock endpoint with a mock ERC20 for testing
pub(crate) fn deploy_mock_endpoint(owner: ContractAddress, eid: u32) -> EndpointV2Mock {
    let ERC20Mock {
        token, dispatcher: token_dispatcher, safe_dispatcher: safe_token_dispatcher, ..,
    } = deploy_mock_erc20(INITIAL_SUPPLY, owner);

    let contract = declare("MockEndpointV2").unwrap_syscall().contract_class();
    let calldata = array![eid.into()];
    let (contract_address, _) = contract.deploy(@calldata).unwrap_syscall();

    EndpointV2Mock {
        endpoint: contract_address,
        dispatcher: IEndpointV2Dispatcher { contract_address },
        safe_dispatcher: IEndpointV2SafeDispatcher { contract_address },
        token,
        token_dispatcher,
        safe_token_dispatcher,
    }
}

/// EndpointV2 deployed for testing
#[derive(Drop)]
pub(crate) struct EndpointV2Deploy {
    pub endpoint: ContractAddress,
    pub dispatcher: IEndpointV2Dispatcher,
    pub safe_dispatcher: IEndpointV2SafeDispatcher,
}

/// Deploy an endpoint with mock ERC20 for testing
pub(crate) fn deploy_endpoint(owner: ContractAddress, eid: u32) -> EndpointV2Deploy {
    let ERC20Mock { token, .. } = deploy_mock_erc20(INITIAL_SUPPLY, owner);
    let blocked_library = deploy_blocked_message_lib();
    let contract = declare("EndpointV2").unwrap_syscall().contract_class();

    let calldata = array![owner.into(), eid.into(), token.into(), blocked_library.into()];
    let (contract_address, _) = contract.deploy(@calldata).unwrap_syscall();

    EndpointV2Deploy {
        endpoint: contract_address,
        dispatcher: IEndpointV2Dispatcher { contract_address },
        safe_dispatcher: IEndpointV2SafeDispatcher { contract_address },
    }
}

/// Messaging composer mock for testing
pub(crate) struct MessagingComposerMock {
    pub composer: ContractAddress,
    pub dispatcher: MockMessagingComposerHelpersDispatcher,
}

/// Deploy a mock messaging composer for testing
pub(crate) fn deploy_mock_messaging_composer(token: ContractAddress) -> MessagingComposerMock {
    let contract = declare("MockMessagingComposer").unwrap_syscall().contract_class();
    let calldata = array![token.into()];
    let (contract_address, _) = contract.deploy(@calldata).unwrap_syscall();

    MessagingComposerMock {
        composer: contract_address,
        dispatcher: MockMessagingComposerHelpersDispatcher { contract_address },
    }
}

/// Deploy a simple message lib for testing
pub(crate) fn deploy_simple_message_lib(endpoint: ContractAddress) -> ContractAddress {
    let contract = declare("SimpleMessageLib").unwrap_syscall().contract_class();
    let (address, _) = contract.deploy(@array![endpoint.into()]).unwrap_syscall();
    address
}

/// Deploy an ultra light node for testing
pub(crate) fn deploy_ultra_light_node_302(
    owner: ContractAddress, endpoint: ContractAddress,
) -> ContractAddress {
    let treasury = ZERO_ADDRESS;
    let treasury_native_fee_cap = 0;

    let contract = declare("UltraLightNode302").unwrap_syscall().contract_class();
    let mut calldata = array![];
    owner.serialize(ref calldata);
    treasury.serialize(ref calldata);
    endpoint.serialize(ref calldata);
    treasury_native_fee_cap.serialize(ref calldata);

    let (address, _) = contract.deploy(@calldata).unwrap_syscall();
    address
}
