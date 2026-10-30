use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};
use starknet::{ContractAddress, SyscallResultTrait};

pub fn deploy_mock_lz_token_fee_lib(fee: u256) -> ContractAddress {
    let contract = declare("MockLzTokenFeeLib").unwrap_syscall().contract_class();
    let (address, _) = contract.deploy(@array![fee.low.into(), fee.high.into()]).unwrap_syscall();
    address
}
