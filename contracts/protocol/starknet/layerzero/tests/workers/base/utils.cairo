//! Base worker test utils

use layerzero::workers::base::interface::{IWorkerBaseDispatcher, IWorkerBaseSafeDispatcher};
use openzeppelin::token::erc20::interface::IERC20Dispatcher;
use snforge_std::fuzzable::FuzzableU16;
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};
use starknet::{ContractAddress, SyscallResultTrait};

/// Mock base worker
pub(crate) struct WorkerBaseMock {
    pub worker: ContractAddress,
    pub dispatcher: IWorkerBaseDispatcher,
    pub safe_dispatcher: IWorkerBaseSafeDispatcher,
}

/// Deploy a base worker contract with given role admin & price feed, random default multiplier bps
/// No additional roles are added
pub(crate) fn deploy_worker_base(
    price_feed: ContractAddress, role_admin: ContractAddress,
) -> WorkerBaseMock {
    deploy_worker_base_with_additional_roles(
        array![].span(), price_feed, role_admin, array![].span(),
    )
}

/// Deploy a base worker contract with given role admin, price feed, message libs, admins
/// & random default multiplier bps
pub(crate) fn deploy_worker_base_with_additional_roles(
    message_libs: Span<ContractAddress>,
    price_feed: ContractAddress,
    role_admin: ContractAddress,
    admins: Span<ContractAddress>,
) -> WorkerBaseMock {
    let default_multiplier_bps = FuzzableU16::generate();

    // Serialize calldata
    let mut calldata = array![];
    message_libs.serialize(ref calldata);
    price_feed.serialize(ref calldata);
    default_multiplier_bps.serialize(ref calldata);
    role_admin.serialize(ref calldata);
    admins.serialize(ref calldata);

    // Deploy contract
    let contract = declare("MockBaseWorker").unwrap_syscall().contract_class();
    let (contract_address, _) = contract.deploy(@calldata).unwrap_syscall();

    WorkerBaseMock {
        worker: contract_address,
        dispatcher: IWorkerBaseDispatcher { contract_address },
        safe_dispatcher: IWorkerBaseSafeDispatcher { contract_address },
    }
}

/// Mock ERC20 token
pub(crate) struct ERC20Mock {
    pub token: ContractAddress,
    pub token_dispatcher: IERC20Dispatcher,
}

/// Deploy a mock ERC20 token with given initial supply & recipient
pub(crate) fn deploy_mock_erc20(initial_supply: u256, recipient: ContractAddress) -> ERC20Mock {
    let contract = declare("MockERC20").unwrap_syscall().contract_class();
    let (token, _) = contract
        .deploy(@array![initial_supply.low.into(), initial_supply.high.into(), recipient.into()])
        .unwrap_syscall();

    ERC20Mock { token, token_dispatcher: IERC20Dispatcher { contract_address: token } }
}
