use common_macros::contract_error;

#[contract_error]
pub enum ExecutorFeeLibError {
    EidNotSupported,
    InvalidExecutorOptions,
    InvalidFee,
    InvalidLzComposeOption,
    InvalidLzReceiveOption,
    InvalidNativeDropOption,
    NativeAmountExceedsCap,
    NoOptions,
    Overflow,
    UnsupportedOptionType,
    ZeroLzComposeGasProvided,
    ZeroLzReceiveGasProvided,
}
