use soroban_sdk::{contractevent, Address};

/// Emitted when the native fee basis points is updated.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NativeFeeBpSet {
    pub native_fee_bp: u32,
}

/// Emitted when fee collection is enabled or disabled.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeEnabledSet {
    pub fee_enabled: bool,
}

/// Emitted when the ZRO fee library is set or removed.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ZroFeeLibSet {
    pub zro_fee_lib: Option<Address>,
}

/// Emitted when a token (including native XLM) is withdrawn from the contract.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenWithdrawn {
    pub token: Address,
    pub to: Address,
    pub amount: i128,
}
