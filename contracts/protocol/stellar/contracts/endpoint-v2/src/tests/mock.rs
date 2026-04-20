use soroban_sdk::{contract, contractimpl, vec, Address, Bytes, Env, Symbol, Vec};

use crate::{
    interfaces::MessagingFee, FeeRecipient, FeesAndPacket, MessageLibType, Origin, OutboundPacket, SetConfigParam,
};

// Mock Receiver Contract for Testing
#[contract]
pub struct MockReceiver;

#[contractimpl]
impl MockReceiver {
    pub fn allow_initialize_path(_env: soroban_sdk::Env, _origin: Origin) -> bool {
        // Default mock implementation returns true
        true
    }
}

#[contract]
pub struct MockReceiverReject;

#[contractimpl]
impl MockReceiverReject {
    pub fn allow_initialize_path(_env: soroban_sdk::Env, _origin: Origin) -> bool {
        // Mock implementation that rejects initialization
        false
    }
}

#[contract]
pub struct MockValidMessageLib;

#[contractimpl]
impl MockValidMessageLib {
    pub fn message_lib_type(_env: &Env) -> MessageLibType {
        MessageLibType::Send
    }
}

// Configurable mock message library for testing
#[contract]
pub struct MockMessageLib;

#[contractimpl]
impl MockMessageLib {
    pub fn setup(env: Env, lib_type: MessageLibType, supported_eids: Vec<u32>) {
        env.storage().instance().set(&Symbol::new(&env, "lib_type"), &lib_type);
        env.storage().instance().set(&Symbol::new(&env, "supported_eids"), &supported_eids);
    }

    pub fn message_lib_type(env: Env) -> MessageLibType {
        env.storage().instance().get(&Symbol::new(&env, "lib_type")).unwrap_or(MessageLibType::Send)
    }

    pub fn is_supported_eid(env: Env, eid: u32) -> bool {
        let supported_eids: Vec<u32> =
            env.storage().instance().get(&Symbol::new(&env, "supported_eids")).unwrap_or(vec![&env]);
        supported_eids.contains(eid)
    }

    /// Stores config for an OApp. This is a minimal implementation to support endpoint tests.
    pub fn set_config(env: Env, oapp: Address, params: Vec<SetConfigParam>) {
        let prefix = Symbol::new(&env, "cfg");
        for p in params.iter() {
            env.storage().instance().set(&(prefix.clone(), oapp.clone(), p.eid, p.config_type), &p.config);
        }
    }

    /// Reads config for an OApp. Returns empty bytes if unset.
    pub fn get_config(env: Env, eid: u32, oapp: Address, config_type: u32) -> Bytes {
        let prefix = Symbol::new(&env, "cfg");
        env.storage().instance().get(&(prefix, oapp, eid, config_type)).unwrap_or(Bytes::new(&env))
    }
}

// Mock send library for testing send/quote operations
#[contract]
pub struct MockSendLib;

#[contractimpl]
impl MockSendLib {
    pub fn setup(env: Env, supported_eids: Vec<u32>, native_fee: i128, zro_fee: i128, fee_recipient: Address) {
        env.storage().instance().set(&Symbol::new(&env, "supported_eids"), &supported_eids);
        env.storage().instance().set(&Symbol::new(&env, "native_fee"), &native_fee);
        env.storage().instance().set(&Symbol::new(&env, "zro_fee"), &zro_fee);
        env.storage().instance().set(&Symbol::new(&env, "fee_recipient"), &fee_recipient);
    }

    pub fn message_lib_type(_env: Env) -> MessageLibType {
        MessageLibType::Send
    }

    pub fn is_supported_eid(env: Env, eid: u32) -> bool {
        let supported_eids: Vec<u32> =
            env.storage().instance().get(&Symbol::new(&env, "supported_eids")).unwrap_or(vec![&env]);
        supported_eids.contains(eid)
    }

    pub fn quote(env: Env, _packet: OutboundPacket, _options: Bytes, _pay_in_zro: bool) -> MessagingFee {
        let native_fee = env.storage().instance().get(&Symbol::new(&env, "native_fee")).unwrap_or(100);
        let zro_fee = env.storage().instance().get(&Symbol::new(&env, "zro_fee")).unwrap_or(0);
        MessagingFee { native_fee, zro_fee }
    }

    pub fn send(env: Env, packet: OutboundPacket, _options: Bytes, _pay_in_zro: bool) -> FeesAndPacket {
        let native_fee = env.storage().instance().get(&Symbol::new(&env, "native_fee")).unwrap_or(100);
        let zro_fee = env.storage().instance().get(&Symbol::new(&env, "zro_fee")).unwrap_or(0);
        let fee_recipient: Address = env.storage().instance().get(&Symbol::new(&env, "fee_recipient")).unwrap();

        let mut native_fee_recipients = Vec::new(&env);
        if native_fee > 0 {
            native_fee_recipients.push_back(FeeRecipient { amount: native_fee, to: fee_recipient.clone() });
        }

        let mut zro_fee_recipients = Vec::new(&env);
        if zro_fee > 0 {
            zro_fee_recipients.push_back(FeeRecipient { amount: zro_fee, to: fee_recipient });
        }

        // Create a simple encoded payload (just the message for simplicity)
        let encoded_packet = packet.message.clone();

        FeesAndPacket { native_fee_recipients, zro_fee_recipients, encoded_packet }
    }
}

// Mock receive library for testing verify operations
#[contract]
pub struct MockReceiveLib;

#[contractimpl]
impl MockReceiveLib {
    pub fn setup(env: Env, supported_eids: Vec<u32>) {
        env.storage().instance().set(&Symbol::new(&env, "supported_eids"), &supported_eids);
    }

    pub fn message_lib_type(_env: Env) -> MessageLibType {
        MessageLibType::Receive
    }

    pub fn is_supported_eid(env: Env, eid: u32) -> bool {
        let supported_eids: Vec<u32> =
            env.storage().instance().get(&Symbol::new(&env, "supported_eids")).unwrap_or(vec![&env]);
        supported_eids.contains(eid)
    }
}
