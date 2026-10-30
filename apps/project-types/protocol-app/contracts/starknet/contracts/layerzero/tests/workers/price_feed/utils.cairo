//! Price feed test utils

use layerzero::workers::price_feed::interface::{
    ILayerZeroPriceFeedDispatcher, ILayerZeroPriceFeedSafeDispatcher, IPriceFeedDispatcher,
    IPriceFeedSafeDispatcher,
};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};
use starknet::{ContractAddress, SyscallResultTrait};

// Constants
pub(crate) const TEN_GWEI: u64 = 10_000_000_000;

/// Price feed mock for testing
pub(crate) struct PriceFeedDeploy {
    pub price_feed: ContractAddress,
    pub dispatcher: IPriceFeedDispatcher,
    pub safe_dispatcher: IPriceFeedSafeDispatcher,
    pub layer_zero: ILayerZeroPriceFeedDispatcher,
    pub safe_layer_zero: ILayerZeroPriceFeedSafeDispatcher,
}

/// Deploy the price feed contract and return the price feed mock
pub(crate) fn deploy_price_feed(
    owner: ContractAddress, price_updater: ContractAddress,
) -> PriceFeedDeploy {
    let contract = declare("PriceFeed").unwrap_syscall().contract_class();
    let calldata = array![owner.into(), price_updater.into()];
    let (contract_address, _) = contract.deploy(@calldata).unwrap_syscall();

    PriceFeedDeploy {
        price_feed: contract_address,
        dispatcher: IPriceFeedDispatcher { contract_address },
        safe_dispatcher: IPriceFeedSafeDispatcher { contract_address },
        layer_zero: ILayerZeroPriceFeedDispatcher { contract_address },
        safe_layer_zero: ILayerZeroPriceFeedSafeDispatcher { contract_address },
    }
}
