use crate::{self as oapp, errors::OAppError};
use common_macros::{contract_trait, only_role, storage};
use soroban_sdk::{assert_with_error, contractevent, contracttype, panic_with_error, Bytes, Env, Vec};
use utils::{buffer_reader::BufferReader, rbac::{RoleBasedAccessControl, AUTHORIZER}};

pub const OPTION_TYPE3: u16 = 3;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EnforcedOptionParam {
    pub eid: u32,
    pub msg_type: u32,
    pub options: Option<Bytes>,
}

#[storage]
pub enum OAppOptionsType3Storage {
    #[persistent(Bytes)]
    EnforcedOptions { eid: u32, msg_type: u32 },
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EnforcedOptionSet {
    pub enforced_options: Vec<EnforcedOptionParam>,
}

// =========================================================================
// OAppOptionsType3 Trait and Default Implementation
// =========================================================================

#[contract_trait]
pub trait OAppOptionsType3: RoleBasedAccessControl {
    /// Retrieves the enforced options for a given endpoint and message type.
    ///
    /// # Arguments
    /// * `eid` - The endpoint ID
    /// * `msg_type` - The OApp message type
    ///
    /// # Returns
    /// The enforced options for the given endpoint and message type
    fn enforced_options(env: &soroban_sdk::Env, eid: u32, msg_type: u32) -> Option<soroban_sdk::Bytes> {
        OAppOptionsType3Storage::enforced_options(env, eid, msg_type)
    }

    /// Sets or removes the enforced options for specific endpoint and message type combinations.
    ///
    /// Only the `authorizer` of the OApp can call this function.
    /// Provides a way for the OApp to enforce things like paying for PreCrime, AND/OR minimum dst lzReceive gas amounts etc.
    /// These enforced options can vary as the potential options/execution on the remote may differ as per the msg_type.
    /// e.g. Amount of lzReceive() gas necessary to deliver a lzCompose() message adds overhead you don't want to pay
    /// if you are only making a standard LayerZero message ie. lzReceive() WITHOUT sendCompose().
    ///
    /// # Arguments
    /// * `options` - A vector of EnforcedOptionParam structures specifying enforced options
    /// * `operator` - The authorizer address
    #[only_role(operator, AUTHORIZER)]
    fn set_enforced_options(
        env: &soroban_sdk::Env,
        options: &soroban_sdk::Vec<oapp::oapp_options_type3::EnforcedOptionParam>,
        operator: &soroban_sdk::Address,
    ) {
        for param in options {
            if let Some(ref opts) = param.options {
                assert_option_type3(env, opts);
            }
            OAppOptionsType3Storage::set_or_remove_enforced_options(env, param.eid, param.msg_type, &param.options);
        }
        EnforcedOptionSet { enforced_options: options.clone() }.publish(env);
    }

    /// Combines options for a given endpoint and message type.
    ///
    /// If there is an enforced lzReceive option:
    /// - {gas_limit: 200k, value: 1 XLM} AND a caller supplies a lzReceive option: {gas_limit: 100k, value: 0.5 XLM}
    /// - The resulting options will be {gas_limit: 300k, value: 1.5 XLM} when the message is executed on the remote lz_receive() function.
    /// The presence of duplicated options is handled off-chain in the verifier/executor.
    ///
    /// # Arguments
    /// * `eid` - The endpoint ID
    /// * `msg_type` - The OApp message type
    /// * `extra_options` - Additional options passed by the caller
    ///
    /// # Returns
    /// The combination of caller specified options AND enforced options
    fn combine_options(
        env: &soroban_sdk::Env,
        eid: u32,
        msg_type: u32,
        extra_options: &soroban_sdk::Bytes,
    ) -> soroban_sdk::Bytes {
        let enforced_options_opt = Self::enforced_options(env, eid, msg_type);

        // No enforced options, pass whatever the caller supplied, even if it's empty or legacy type 1/2 options.
        if enforced_options_opt.is_none() {
            return extra_options.clone();
        }

        // No caller options, return enforced
        let mut enforced_options = enforced_options_opt.unwrap(); // unwrap is safe because we checked if it is none above
        if extra_options.is_empty() {
            return enforced_options;
        }

        // If caller provided extra_options, must be type 3 as its the ONLY type that can be combined.
        if extra_options.len() >= 2 {
            assert_option_type3(env, extra_options);

            // Remove the first 2 bytes containing the type from the extra_options and combine with enforced.
            enforced_options.append(&extra_options.slice(2..));
            return enforced_options;
        }

        // No valid set of options was found.
        panic_with_error!(env, OAppError::InvalidOptions);
    }
}

// =========================================================================
// Helpers Functions
// =========================================================================

/// Asserts that the provided options are of type 3.
///
/// # Arguments
/// * `options` - The options to be checked
///
/// # Panics
/// If the options are not of type 3
pub fn assert_option_type3(env: &Env, options: &Bytes) {
    let options_type = BufferReader::new(options).read_u16();
    assert_with_error!(env, options_type == OPTION_TYPE3, OAppError::InvalidOptions);
}
