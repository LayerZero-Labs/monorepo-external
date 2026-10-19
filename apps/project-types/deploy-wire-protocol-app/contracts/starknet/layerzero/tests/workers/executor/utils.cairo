//! Executor test utils

use layerzero::common::constants::BPS_DENOMINATOR;
use layerzero::common::structs::packet::Origin;
use layerzero::workers::base::interface::IWorkerBaseDispatcher;
use layerzero::workers::base::structs::QuoteParams;
use layerzero::workers::executor::fee_lib::interface::{
    IExecutorFeeLibDispatcher, IExecutorFeeLibSafeDispatcher,
};
use layerzero::workers::executor::interface::{IExecutorDispatcher, IExecutorSafeDispatcher};
use layerzero::workers::executor::structs::{ComposeParams, ExecuteParams};
use layerzero::workers::interface::{ILayerZeroWorkerDispatcher, ILayerZeroWorkerSafeDispatcher};
use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
use lz_utils::bytes::Bytes32;
use openzeppelin::access::accesscontrol::interface::{
    IAccessControlDispatcher, IAccessControlSafeDispatcher,
};
use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
use snforge_std::fuzzable::FuzzableU256;
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::cheat_caller_address_once;
use crate::endpoint::utils::{ERC20Mock, EndpointV2Mock, deploy_mock_endpoint, deploy_mock_erc20};
use crate::mocks::workers::executor::decode::interface::{
    IMockExecutorDecodeDispatcher, IMockExecutorDecodeSafeDispatcher,
};

/// Default worker id
pub(crate) const WORKER_ID: u8 = 1;
pub(crate) const TOKEN_SUPPLY: u256 = 1_000_000;
pub(crate) const EXECUTOR_ROLE_ADMIN: ContractAddress = 'executor_role_admin'.try_into().unwrap();

/// Executor for testing
pub(crate) struct ExecutorTest {
    pub executor: ContractAddress,
    pub endpoint: ContractAddress,
    pub dispatcher: IExecutorDispatcher,
    pub safe_dispatcher: IExecutorSafeDispatcher,
    pub base_worker: IWorkerBaseDispatcher,
    pub access_control: IAccessControlDispatcher,
    pub safe_access_control: IAccessControlSafeDispatcher,
    pub token: ContractAddress,
    pub token_dispatcher: IERC20Dispatcher,
    pub layer_zero_worker: ILayerZeroWorkerDispatcher,
    pub safe_layer_zero_worker: ILayerZeroWorkerSafeDispatcher,
}

/// Executor Fee Lib for testing
pub(crate) struct ExecutorFeeLibTest {
    pub fee_lib: ContractAddress,
    pub dispatcher: IExecutorFeeLibDispatcher,
    pub safe_dispatcher: IExecutorFeeLibSafeDispatcher,
}

/// Deploy Executor Fee Lib for testing
pub(crate) fn deploy_executor_fee_lib(
    local_eid_v2: u32, owner: ContractAddress,
) -> ExecutorFeeLibTest {
    let contract = declare("ExecutorFeeLib").unwrap_syscall().contract_class();

    // Serialize constructor arguments
    let mut calldata = array![];
    local_eid_v2.serialize(ref calldata);
    owner.serialize(ref calldata);

    let (contract_address, _) = contract.deploy(@calldata).unwrap_syscall();

    ExecutorFeeLibTest {
        fee_lib: contract_address,
        dispatcher: IExecutorFeeLibDispatcher { contract_address },
        safe_dispatcher: IExecutorFeeLibSafeDispatcher { contract_address },
    }
}

/// Deploy the executor contract with given role admin, price feed admins
pub(crate) fn deploy_executor(
    endpoint_owner: ContractAddress,
    message_libs: Span<ContractAddress>,
    price_feed: ContractAddress,
    role_admin: ContractAddress,
    admins: Span<ContractAddress>,
    token_owner: ContractAddress,
    eid: u32,
) -> ExecutorTest {
    deploy_executor_with_all_data(
        endpoint_owner,
        message_libs,
        price_feed,
        BPS_DENOMINATOR.try_into().unwrap(),
        role_admin,
        admins,
        token_owner,
        eid,
    )
}

/// Deploy the executor contract with given data
fn deploy_executor_with_all_data(
    endpoint_owner: ContractAddress,
    message_libs: Span<ContractAddress>,
    price_feed: ContractAddress,
    default_multiplier_bps: u16,
    role_admin: ContractAddress,
    admins: Span<ContractAddress>,
    token_owner: ContractAddress,
    eid: u32,
) -> ExecutorTest {
    // Deploy mock ERC20 token
    let ERC20Mock {
        token, dispatcher: token_dispatcher, ..,
    } = deploy_mock_erc20(TOKEN_SUPPLY, token_owner);

    // Deploy mock endpoint contract
    let EndpointV2Mock { endpoint, .. } = deploy_mock_endpoint(endpoint_owner, eid);

    // Serialize calldata
    let mut calldata = array![];
    endpoint.serialize(ref calldata);
    message_libs.serialize(ref calldata);
    price_feed.serialize(ref calldata);
    default_multiplier_bps.serialize(ref calldata);
    role_admin.serialize(ref calldata);
    admins.serialize(ref calldata);
    token.serialize(ref calldata);

    // Deploy contract
    let contract = declare("Executor").unwrap_syscall().contract_class();
    let (contract_address, _) = contract.deploy(@calldata).unwrap_syscall();

    cheat_caller_address_once(token, token_owner);
    token_dispatcher.transfer(contract_address, TOKEN_SUPPLY);

    ExecutorTest {
        executor: contract_address,
        endpoint,
        dispatcher: IExecutorDispatcher { contract_address },
        safe_dispatcher: IExecutorSafeDispatcher { contract_address },
        base_worker: IWorkerBaseDispatcher { contract_address },
        access_control: IAccessControlDispatcher { contract_address },
        safe_access_control: IAccessControlSafeDispatcher { contract_address },
        layer_zero_worker: ILayerZeroWorkerDispatcher { contract_address },
        safe_layer_zero_worker: ILayerZeroWorkerSafeDispatcher { contract_address },
        token,
        token_dispatcher,
    }
}

/// Executor mock for testing
pub(crate) struct ExecutorMock {
    pub executor: ContractAddress,
    pub dispatcher: IExecutorDispatcher,
    pub safe_dispatcher: IExecutorSafeDispatcher,
}

/// Deploy mock executor contract with given data - random quote result
pub(crate) fn deploy_mock_executor(
    endpoint: ContractAddress, token_address: ContractAddress, composer: ContractAddress,
) -> ExecutorMock {
    let quote_result = FuzzableU256::generate();

    // Serialize calldata
    let mut calldata = array![];
    quote_result.serialize(ref calldata);
    endpoint.serialize(ref calldata);
    token_address.serialize(ref calldata);
    composer.serialize(ref calldata);

    // Deploy contract
    let contract = declare("MockExecutor").unwrap_syscall().contract_class();
    let (contract_address, _) = contract.deploy(@calldata).unwrap_syscall();

    ExecutorMock {
        executor: contract_address,
        dispatcher: IExecutorDispatcher { contract_address },
        safe_dispatcher: IExecutorSafeDispatcher { contract_address },
    }
}

/// Create mock quote params for testing
pub(crate) fn create_mock_quote_params(
    sender: ContractAddress, dst_eid: u32, options: ByteArray,
) -> QuoteParams {
    QuoteParams { dst_eid, sender, calldata_size: 100, options, confirmations: 0 }
}

/// Create mock execute params for testing
pub(crate) fn create_mock_execute_params(eid: u32, receiver: ContractAddress) -> ExecuteParams {
    ExecuteParams {
        origin: Origin { src_eid: eid, ..Default::default() },
        receiver,
        guid: Default::default(),
        message: Default::default(),
        value: Default::default(),
        extra_data: Default::default(),
        gas_limit: Default::default(),
    }
}

/// Create mock compose params for testing
pub(crate) fn create_mock_compose_params(
    sender: ContractAddress, receiver: ContractAddress,
) -> ComposeParams {
    ComposeParams {
        sender,
        receiver,
        guid: Default::default(),
        index: Default::default(),
        message: Default::default(),
        extra_data: Default::default(),
        value: Default::default(),
        gas_limit: Default::default(),
    }
}

/// Executor decode mock for testing
pub(crate) struct ExecutorDecodeMock {
    pub executor: ContractAddress,
    pub dispatcher: IMockExecutorDecodeDispatcher,
    pub safe_dispatcher: IMockExecutorDecodeSafeDispatcher,
}

/// Deploy the executor decode contract and return the executor decode mock
pub(crate) fn deploy_executor_decode() -> ExecutorDecodeMock {
    let contract = declare("MockExecutorDecode").unwrap_syscall().contract_class();
    let (contract_address, _) = contract.deploy(@array![]).unwrap_syscall();

    ExecutorDecodeMock {
        executor: contract_address,
        dispatcher: IMockExecutorDecodeDispatcher { contract_address },
        safe_dispatcher: IMockExecutorDecodeSafeDispatcher { contract_address },
    }
}

#[derive(Drop)]
pub(crate) struct ExecutorOptionBytes {
    pub option_type: u8,
    pub option: ByteArray,
}

/// Helper to build executor options from a list of executor options.
pub(crate) fn serialize_executor_options(options: Array<ExecutorOptionBytes>) -> ByteArray {
    let mut serialized_options: ByteArray = Default::default();

    for executor_option in options {
        let ExecutorOptionBytes { option_type, option } = executor_option;

        let mut option_data = Default::default();
        // add worker id
        option_data.append_u8(WORKER_ID);
        // add option len (EVM parity: includes type byte)
        let option_len_total: u16 = (option.len() + 1).try_into().unwrap();
        option_data.append_u16(option_len_total);
        // add option type
        option_data.append_u8(option_type);
        // add option data
        option_data.append(@option);

        serialized_options.append(@option_data);
    }

    serialized_options
}

pub(crate) fn serialize_lz_receive_option(gas: u128, value: Option<u128>) -> ByteArray {
    let mut option_data = Default::default();
    option_data.append_u128(gas);

    if let Some(v) = value {
        option_data.append_u128(v);
    }

    option_data
}

pub(crate) fn serialize_native_drop_option(amount: u128, receiver: Bytes32) -> ByteArray {
    let mut option_data = Default::default();
    option_data.append_u128(amount);
    option_data.append_u256(receiver.value);
    option_data
}

pub(crate) fn serialize_lz_compose_option(index: u16, gas: u128, value: Option<u128>) -> ByteArray {
    let mut option_data = Default::default();
    option_data.append_u16(index);
    option_data.append_u128(gas);

    if let Some(v) = value {
        option_data.append_u128(v);
    }

    option_data
}

pub(crate) fn serialize_lz_read_option(gas: u128, size: u32, value: Option<u128>) -> ByteArray {
    let mut option_data = Default::default();
    option_data.append_u128(gas);
    option_data.append_u32(size);

    if let Some(v) = value {
        option_data.append_u128(v);
    }

    option_data
}
