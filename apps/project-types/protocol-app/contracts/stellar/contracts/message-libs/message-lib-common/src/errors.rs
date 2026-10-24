use common_macros::contract_error;

// Message Lib Common error codes: 1100-1199
// See docs/error-spec.md for allocation rules

/// PacketCodecV1Error: 1100-1109
#[contract_error]
pub enum PacketCodecV1Error {
    InvalidPacketHeader = 1100,
    InvalidPacketVersion,
}

/// WorkerOptionsError: 1110-1119
#[contract_error]
pub enum WorkerOptionsError {
    InvalidBytesLength = 1110,
    InvalidLegacyOptionsType1,
    InvalidLegacyOptionsType2,
    InvalidOptionType,
    InvalidOptions,
    InvalidWorkerId,
    LegacyOptionsType1GasOverflow,
    LegacyOptionsType2AmountOverflow,
    LegacyOptionsType2GasOverflow,
}
