//! Base worker errors

use lz_utils::error::{Error, format_error};

#[derive(Drop, Clone, Debug, PartialEq)]
pub enum WorkerBaseError {
    RoleRenouncingDisabled,
    SenderNotAllowed,
    TransferFailed,
}

impl WorkerBaseErrorImpl of Error<WorkerBaseError> {
    fn prefix() -> ByteArray {
        "LZ_WORKER_BASE"
    }

    fn name(self: WorkerBaseError) -> ByteArray {
        match self {
            WorkerBaseError::RoleRenouncingDisabled => "ROLE_RENOUNCING_DISABLED",
            WorkerBaseError::SenderNotAllowed => "SENDER_NOT_ALLOWED",
            WorkerBaseError::TransferFailed => "TRANSFER_FAILED",
        }
    }
}

pub fn err_role_renouncing_disabled() -> ByteArray {
    format_error(WorkerBaseError::RoleRenouncingDisabled, "")
}

pub fn err_sender_not_allowed() -> ByteArray {
    format_error(WorkerBaseError::SenderNotAllowed, "")
}

pub fn err_transfer_failed() -> ByteArray {
    format_error(WorkerBaseError::TransferFailed, "")
}
