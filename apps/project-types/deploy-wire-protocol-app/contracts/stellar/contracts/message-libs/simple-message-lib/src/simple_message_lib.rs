use crate::{errors::SimpleMessageLibError, storage::SmlStorage};
use common_macros::{contract_impl, lz_contract, only_auth};
use endpoint_v2::{
    FeeRecipient, FeesAndPacket, IMessageLib, ISendLib, LayerZeroEndpointV2Client, MessageLibType, MessageLibVersion,
    MessagingFee, Origin, OutboundPacket, SetConfigParam,
};
use message_lib_common::packet_codec_v1;
use soroban_sdk::{address_payload::AddressPayload, panic_with_error, vec, Address, Bytes, BytesN, Env, Vec};

#[lz_contract]
pub struct SimpleMessageLib;

#[contract_impl]
impl SimpleMessageLib {
    pub fn __constructor(env: &Env, owner: &Address, endpoint: &Address, fee_recipient: &Address) {
        let endpoint_client = LayerZeroEndpointV2Client::new(env, endpoint);
        let local_eid = endpoint_client.eid();

        SmlStorage::set_endpoint(env, endpoint);
        SmlStorage::set_local_eid(env, &local_eid);
        SmlStorage::set_zro_fee(env, &99_i128);
        SmlStorage::set_native_fee(env, &100_i128);
        SmlStorage::set_fee_recipient(env, fee_recipient);
        SmlStorage::set_whitelisted_caller(env, owner);

        Self::init_owner(env, owner);
    }

    pub fn validate_packet(env: &Env, header_bytes: Bytes, payload_hash: BytesN<32>) {
        Self::whitelisted_caller(env).require_auth();

        let header = packet_codec_v1::decode_packet_header(env, &header_bytes);
        let origin = Origin { src_eid: header.src_eid, sender: header.sender, nonce: header.nonce };

        // Enforce receiver is a contract address
        let receiver = Address::from_payload(env, AddressPayload::ContractIdHash(header.receiver));
        Self::endpoint_client(env).verify(&env.current_contract_address(), &origin, &receiver, &payload_hash);
    }

    // ============================================================================================
    // Admin Manager
    // ============================================================================================

    #[only_auth]
    pub fn set_fee_recipient(env: &Env, fee_recipient: &Address) {
        SmlStorage::set_fee_recipient(env, fee_recipient);
    }

    #[only_auth]
    pub fn set_native_fee(env: &Env, native_fee: &i128) {
        SmlStorage::set_native_fee(env, native_fee);
    }

    #[only_auth]
    pub fn set_zro_fee(env: &Env, zro_fee: &i128) {
        SmlStorage::set_zro_fee(env, zro_fee);
    }

    #[only_auth]
    pub fn set_whitelisted_caller(env: &Env, whitelisted_caller: &Address) {
        SmlStorage::set_whitelisted_caller(env, whitelisted_caller);
    }

    // ============================================================================================
    // View Functions
    // ============================================================================================

    pub fn endpoint(env: &Env) -> Address {
        SmlStorage::endpoint(env).unwrap()
    }

    pub fn local_eid(env: &Env) -> u32 {
        SmlStorage::local_eid(env).unwrap()
    }

    pub fn native_fee(env: &Env) -> i128 {
        SmlStorage::native_fee(env).unwrap()
    }

    pub fn zro_fee(env: &Env) -> i128 {
        SmlStorage::zro_fee(env).unwrap()
    }

    pub fn fee_recipient(env: &Env) -> Address {
        SmlStorage::fee_recipient(env).unwrap()
    }

    pub fn whitelisted_caller(env: &Env) -> Address {
        SmlStorage::whitelisted_caller(env).unwrap()
    }

    // ==== Internal helpers ====

    fn require_endpoint_auth(env: &Env) {
        Self::endpoint(env).require_auth();
    }

    fn endpoint_client(env: &Env) -> LayerZeroEndpointV2Client<'_> {
        LayerZeroEndpointV2Client::new(env, &Self::endpoint(env))
    }
}

#[contract_impl]
impl IMessageLib for SimpleMessageLib {
    fn get_config(env: &Env, _eid: u32, _oapp: &Address, _config_type: u32) -> Bytes {
        panic_with_error!(env, SimpleMessageLibError::NotImplemented);
    }

    fn is_supported_eid(_env: &Env, _eid: u32) -> bool {
        true
    }

    fn message_lib_type(_env: &Env) -> MessageLibType {
        MessageLibType::SendAndReceive
    }

    fn set_config(env: &Env, _oapp: &Address, _param: &Vec<SetConfigParam>) {
        panic_with_error!(env, SimpleMessageLibError::NotImplemented);
    }

    fn version(_env: &Env) -> MessageLibVersion {
        MessageLibVersion { major: 0, minor: 0, endpoint_version: 2 }
    }
}

#[contract_impl]
impl ISendLib for SimpleMessageLib {
    fn quote(env: &Env, _packet: &OutboundPacket, _options: &Bytes, pay_in_zro: bool) -> MessagingFee {
        MessagingFee { native_fee: Self::native_fee(env), zro_fee: if pay_in_zro { Self::zro_fee(env) } else { 0 } }
    }

    fn send(env: &Env, packet: &OutboundPacket, _options: &Bytes, pay_in_zro: bool) -> FeesAndPacket {
        Self::require_endpoint_auth(env);

        let native_fee_recipients =
            vec![env, FeeRecipient { to: Self::fee_recipient(env), amount: Self::native_fee(env) }];

        let mut zro_fee_recipients = vec![env];
        if pay_in_zro {
            zro_fee_recipients.push_back(FeeRecipient { to: Self::fee_recipient(env), amount: Self::zro_fee(env) });
        }

        FeesAndPacket {
            native_fee_recipients,
            zro_fee_recipients,
            encoded_packet: packet_codec_v1::encode_packet(env, packet),
        }
    }
}
