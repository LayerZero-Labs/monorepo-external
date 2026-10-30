use lz_utils::error::{Error, format_error};

/// A rate limiter error
#[derive(Drop)]
pub enum RateLimiterError {
    /// A rate limit is exceeded.
    RateLimitExceeded,
}

impl ErrorNameImpl of Error<RateLimiterError> {
    fn prefix() -> ByteArray {
        "LZ_OAPP_RATE_LIMITER"
    }

    fn name(self: RateLimiterError) -> ByteArray {
        match self {
            RateLimiterError::RateLimitExceeded => "RATE_LIMIT_EXCEEDED",
        }
    }
}

pub fn err_rate_limit_exceeded() -> ByteArray {
    format_error(RateLimiterError::RateLimitExceeded, "")
}
