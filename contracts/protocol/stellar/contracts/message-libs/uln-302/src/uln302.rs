use crate::{
    errors::Uln302Error,
    interfaces::{IReceiveUln302, ISendUln302},
    storage::UlnStorage,
};
use common_macros::{contract_impl, lz_contract};
use endpoint_v2::{IMessageLib, MessageLibType, MessageLibVersion, SetConfigParam};
use soroban_sdk::{
    assert_with_error, panic_with_error,
    xdr::{FromXdr, ToXdr},
    Address, Bytes, Env, Vec,
};
use utils::option_ext::OptionExt;

/// Configuration type for executor settings (max message size, executor address)
pub const CONFIG_TYPE_EXECUTOR: u32 = 1;
/// Configuration type for send-side ULN settings (DVNs, confirmations)
pub const CONFIG_TYPE_SEND_ULN: u32 = 2;
/// Configuration type for receive-side ULN settings (DVNs, confirmations)
pub const CONFIG_TYPE_RECEIVE_ULN: u32 = 3;

#[lz_contract]
pub struct Uln302;

#[contract_impl]
impl Uln302 {
    pub fn __constructor(env: &Env, owner: &Address, endpoint: &Address, treasury: &Address) {
        Self::init_owner(env, owner);
        UlnStorage::set_endpoint(env, endpoint);
        UlnStorage::set_treasury(env, treasury);
    }

    /// Returns the LayerZero endpoint contract address.
    pub fn endpoint(env: &Env) -> Address {
        UlnStorage::endpoint(env).unwrap()
    }
}

#[contract_impl]
impl IMessageLib for Uln302 {
    /// Sets OApp-specific configuration parameters for the message library.
    ///
    /// Called by the endpoint on behalf of the OApp to configure executor and ULN settings.
    /// Supports three config types: EXECUTOR, SEND_ULN, and RECEIVE_ULN.
    fn set_config(env: &Env, oapp: &Address, params: &Vec<SetConfigParam>) {
        Self::endpoint(env).require_auth();

        for param in params {
            assert_with_error!(env, Self::is_supported_eid(env, param.eid), Uln302Error::UnsupportedEid);

            match param.config_type {
                CONFIG_TYPE_EXECUTOR => {
                    Self::set_executor_config(env, oapp, param.eid, &parse_config(env, &param.config));
                }
                CONFIG_TYPE_SEND_ULN => {
                    Self::set_send_uln_config(env, oapp, param.eid, &parse_config(env, &param.config));
                }
                CONFIG_TYPE_RECEIVE_ULN => {
                    Self::set_receive_uln_config(env, oapp, param.eid, &parse_config(env, &param.config));
                }
                _ => panic_with_error!(env, Uln302Error::InvalidConfigType),
            }
        }
    }

    /// Returns the XDR-encoded effective configuration bytes.
    fn get_config(env: &Env, eid: u32, oapp: &Address, config_type: u32) -> Bytes {
        match config_type {
            CONFIG_TYPE_EXECUTOR => Self::effective_executor_config(env, oapp, eid).to_xdr(env),
            CONFIG_TYPE_SEND_ULN => Self::effective_send_uln_config(env, oapp, eid).to_xdr(env),
            CONFIG_TYPE_RECEIVE_ULN => Self::effective_receive_uln_config(env, oapp, eid).to_xdr(env),
            _ => panic_with_error!(env, Uln302Error::InvalidConfigType),
        }
    }

    /// Returns true if the message library has full default configurations for the endpoint ID.
    fn is_supported_eid(env: &Env, eid: u32) -> bool {
        UlnStorage::has_default_executor_configs(env, eid)
            && UlnStorage::has_default_send_uln_configs(env, eid)
            && UlnStorage::has_default_receive_uln_configs(env, eid)
    }

    /// Returns the version of the message library.
    fn version(_env: &Env) -> MessageLibVersion {
        MessageLibVersion { major: 3, minor: 0, endpoint_version: 2 }
    }

    /// Returns the type of the message library.
    fn message_lib_type(_env: &Env) -> MessageLibType {
        MessageLibType::SendAndReceive
    }
}

/// Parse a config from XDR bytes, panicking with InvalidConfig error if parsing fails
fn parse_config<T: FromXdr>(env: &Env, config_bytes: &Bytes) -> T {
    T::from_xdr(env, config_bytes).ok().unwrap_or_panic(env, Uln302Error::InvalidConfig)
}

#[path = "receive_uln.rs"]
mod receive_uln;
#[path = "send_uln.rs"]
mod send_uln;
