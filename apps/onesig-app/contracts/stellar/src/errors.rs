use common_macros::contract_error;

#[contract_error]
pub enum OneSigError {
    ExecutorAlreadyExists,
    ExecutorAlreadyInitialized,
    ExecutorNotFound,
    InvalidAuthContext,
    InvalidProofOrNonce,
    MerkleRootExpired,
    NonContractInvoke,
    OnlyExecutorOrSigner,
    SignerExecutionProofExpired,
}
