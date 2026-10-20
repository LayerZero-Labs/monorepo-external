use anchor_lang::prelude::error_code;

#[error_code]
pub enum OneSigError {
    #[msg("Value is already present in the list")]
    AlreadyAdded,
    #[msg("Provide exactly one calls source: inline transaction or buffered transaction")]
    AmbiguousCallsSource,
    #[msg("Provide exactly one signatures source: inline signatures or buffered signatures")]
    AmbiguousSignaturesSource,
    #[msg("Append start offset does not match the current buffered length")]
    BufferedStartOffsetMismatch,
    #[msg("Number of calls does not match the number of call account lists")]
    CallAccountCountMismatch,
    #[msg("The calls list is empty")]
    EmptyCalls,
    #[msg("OneSig signer balance decreased by more than its allowed value")]
    ExcessiveBalanceDeduction,
    #[msg("Executor not found in the allowlist")]
    ExecutorNotFound,
    #[msg("An allowlisted executor or a signer authorization is required")]
    ExecutorRequired,
    #[msg("Signer execution authorization has expired")]
    ExpiredSignerExecutionProof,
    #[msg("Failed to recover the signer from the signature")]
    FailedSignatureRecovery,
    #[msg("Not enough valid signatures to meet the threshold")]
    InsufficientSignatures,
    #[msg("Buffered transaction calls data is malformed or incomplete")]
    InvalidBufferedTransactionCallsData,
    #[msg("closable_after_nonce must be greater than or equal to the current nonce")]
    InvalidClosableNonce,
    #[msg("Invalid execute transaction parameters")]
    InvalidExecuteParams,
    #[msg("Executor address is invalid")]
    InvalidExecutor,
    #[msg("Merkle proof does not match the expected root")]
    InvalidProof,
    #[msg("Signature has an invalid format or length")]
    InvalidSignatureFormat,
    #[msg("Signer address is invalid")]
    InvalidSigner,
    #[msg("OneSig signer PDA is no longer owned by the system program")]
    InvalidSignerOwner,
    #[msg("Threshold must be greater than zero")]
    InvalidThreshold,
    #[msg("The list has reached its maximum capacity")]
    ListAtCapacity,
    #[msg("Signature is malleable: s is in the upper half of the curve order (expected low-S)")]
    MalleableSignature,
    #[msg("Merkle root has expired")]
    MerkleRootExpired,
    #[msg("Call is missing its target program id index")]
    MissingProgramId,
    #[msg("Buffered account authority must be provided to close the PDA")]
    MissingBufferedAuthorityForClose,
    #[msg("OneSig signer PDA must not hold any data after execution")]
    NonEmptySignerData,
    #[msg("OneSig nonce was mutated during execution")]
    NonceMutatedDuringExecution,
    #[msg("Re-entrant call into execute_transaction is not allowed")]
    Reentrancy,
    #[msg("Signature data length is not a multiple of the signature size")]
    SignatureDataSizeMismatch,
    #[msg("Signer execution authorization was not signed by a registered signer")]
    SignerExecutionProofUnauthorized,
    #[msg("Signer not found in the signer set")]
    SignerNotFound,
    #[msg("Threshold exceeds the number of signers")]
    ThresholdExceedsSigners,
    #[msg("Caller is not the authority of the buffered account")]
    UnauthorizedBufferedAuthority,
}
