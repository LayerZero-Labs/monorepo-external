//! OFTMintBurnAdapter test utils

use core::num::traits::Pow;
use oft_mint_burn::erc20_mint_burn_upgradeable::constants::{BURNER_ROLE, MINTER_ROLE};
use openzeppelin::access::accesscontrol::interface::{
    IAccessControlDispatcher, IAccessControlDispatcherTrait,
};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare, mock_call};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::cheat_caller_address_once;

pub const NATIVE_TOKEN_OWNER: ContractAddress = 'native_token_owner'.try_into().unwrap();
pub const ERC20_TOKEN_OWNER: ContractAddress = 'erc20_token_owner'.try_into().unwrap();
pub const LZ_ENDPOINT: ContractAddress = 'lz_endpoint'.try_into().unwrap();
pub const OFT_OWNER: ContractAddress = 'oft_owner'.try_into().unwrap();
pub const SHARED_DECIMALS: u8 = 6;
pub const LOCAL_DECIMALS: u8 = 18;
const DECIMAL_DIFF: u8 = LOCAL_DECIMALS - SHARED_DECIMALS;
pub const DIFF_DECIMALS: u256 = 10_u256.pow(DECIMAL_DIFF.into());

pub(crate) struct OFTMintBurnAdapterDeploy {
    pub oft_mint_burn_adapter: ContractAddress,
    pub native_token: ContractAddress,
    pub erc20_token: ContractAddress,
}

fn deploy_mock_erc20(
    owner: ContractAddress, name: ByteArray, symbol: ByteArray,
) -> ContractAddress {
    let contract = declare("ERC20MintBurnUpgradeable").unwrap_syscall().contract_class();

    let mut calldata = array![];
    name.serialize(ref calldata);
    symbol.serialize(ref calldata);
    LOCAL_DECIMALS.serialize(ref calldata); // decimals
    owner.serialize(ref calldata); // default_admin
    let (contract_address, _) = contract.deploy(@calldata).unwrap_syscall();

    contract_address
}

fn deploy_oft_mint_burn_adapter(
    erc20_token: ContractAddress,
    minter_burner: ContractAddress,
    lz_endpoint: ContractAddress,
    owner: ContractAddress,
    native_token: ContractAddress,
) -> ContractAddress {
    let contract = declare("OFTMintBurnAdapter").unwrap_syscall().contract_class();
    let calldata = array![
        erc20_token.into(), minter_burner.into(), lz_endpoint.into(), owner.into(),
        native_token.into(), SHARED_DECIMALS.into(),
    ];

    mock_call(LZ_ENDPOINT, selector!("set_delegate"), (), 1);
    let (contract_address, _) = contract.deploy(@calldata).unwrap_syscall();

    contract_address
}

pub fn setup_mint_burn_adapter() -> OFTMintBurnAdapterDeploy {
    let native_token = deploy_mock_erc20(NATIVE_TOKEN_OWNER, "STARK", "STK");
    let erc20_token = deploy_mock_erc20(ERC20_TOKEN_OWNER, "CustomToken", "CT");

    // Deploy the OFT adapter with the erc20_token as the minter_burner
    let oft_mint_burn_adapter = deploy_oft_mint_burn_adapter(
        erc20_token, erc20_token, LZ_ENDPOINT, OFT_OWNER, native_token,
    );

    // Grant MINTER_ROLE and BURNER_ROLE to the OFT adapter
    cheat_caller_address_once(erc20_token, ERC20_TOKEN_OWNER);
    IAccessControlDispatcher { contract_address: erc20_token }
        .grant_role(MINTER_ROLE, oft_mint_burn_adapter);
    cheat_caller_address_once(erc20_token, ERC20_TOKEN_OWNER);
    IAccessControlDispatcher { contract_address: erc20_token }
        .grant_role(BURNER_ROLE, oft_mint_burn_adapter);

    // Grant MINTER_ROLE to NATIVE_TOKEN_OWNER for native token minting in tests
    cheat_caller_address_once(native_token, NATIVE_TOKEN_OWNER);
    IAccessControlDispatcher { contract_address: native_token }
        .grant_role(MINTER_ROLE, NATIVE_TOKEN_OWNER);

    OFTMintBurnAdapterDeploy { oft_mint_burn_adapter, native_token, erc20_token }
}
