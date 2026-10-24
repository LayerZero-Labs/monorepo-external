//! # Block Message Library
//!
//! A special message library that blocks all messaging operations.
//!
//! This library is used as a blocklist mechanism to prevent OApps from sending
//! or receiving cross-chain messages. When assigned as an OApp's send or receive
//! library, all quote, send, and config operations will fail.
//!
//! Use cases:
//! - Temporarily disable messaging for an OApp
//! - Emergency circuit breaker for cross-chain communication

#![no_std]

#[cfg(test)]
mod tests;

use common_macros::contract_error;
use endpoint_v2::{
    FeesAndPacket, IMessageLib, ISendLib, MessageLibType, MessageLibVersion, MessagingFee, OutboundPacket,
    SetConfigParam,
};
use soroban_sdk::{contract, contractimpl, panic_with_error, Address, Bytes, Env, Vec};

#[contract_error]
pub enum BlockedMessageLibError {
    NotImplemented,
}

/// Block Message Library contract that rejects all messaging operations.
#[contract]
pub struct BlockedMessageLib;

#[contractimpl]
impl IMessageLib for BlockedMessageLib {
    /// Always panics - config modification is not supported.
    fn set_config(env: &Env, _oapp: &Address, _param: &Vec<SetConfigParam>) {
        panic_with_error!(&env, BlockedMessageLibError::NotImplemented);
    }

    /// Always panics - config retrieval is not supported.
    fn get_config(env: &Env, _eid: u32, _oapp: &Address, _config_type: u32) -> Bytes {
        panic_with_error!(&env, BlockedMessageLibError::NotImplemented);
    }

    /// Returns true for all EIDs to allow assignment as a blocking library.
    fn is_supported_eid(_env: &Env, _eid: u32) -> bool {
        true
    }

    /// Returns max version to ensure it's recognized as a valid library.
    fn version(_env: &Env) -> MessageLibVersion {
        MessageLibVersion { major: u64::MAX, minor: u8::MAX as u32, endpoint_version: 2 }
    }

    /// Returns SendAndReceive to indicate it can block both directions.
    fn message_lib_type(_env: &Env) -> MessageLibType {
        MessageLibType::SendAndReceive
    }
}

#[contractimpl]
impl ISendLib for BlockedMessageLib {
    /// Always panics - quoting is blocked.
    fn quote(env: &Env, _packet: &OutboundPacket, _options: &Bytes, _pay_in_zro: bool) -> MessagingFee {
        panic_with_error!(&env, BlockedMessageLibError::NotImplemented);
    }

    /// Always panics - sending is blocked.
    fn send(env: &Env, _packet: &OutboundPacket, _options: &Bytes, _pay_in_zro: bool) -> FeesAndPacket {
        panic_with_error!(&env, BlockedMessageLibError::NotImplemented);
    }
}
