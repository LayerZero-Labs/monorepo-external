use common_macros::contract_error;

#[contract_error]
pub enum ExecutorError {
    EidNotSupported,
    Unauthorized,
    UnauthorizedContext,
}
