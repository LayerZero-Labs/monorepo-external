use lz_utils::error::{Error, format_error};

#[derive(Drop)]
pub enum OAppOptionsType3Error {
    InvalidOptions,
}

impl ErrorNameImpl of Error<OAppOptionsType3Error> {
    fn prefix() -> ByteArray {
        "LZ_OAPP_OPTIONS_TYPE3"
    }

    fn name(self: OAppOptionsType3Error) -> ByteArray {
        match self {
            OAppOptionsType3Error::InvalidOptions => "INVALID_OPTIONS",
        }
    }
}

pub fn err_invalid_options(options: @ByteArray) -> ByteArray {
    format_error(OAppOptionsType3Error::InvalidOptions, format!("options: {}", options))
}
