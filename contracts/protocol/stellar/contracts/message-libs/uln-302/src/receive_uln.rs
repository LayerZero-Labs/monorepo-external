use super::{Uln302, Uln302Args, Uln302Client};
use crate::{
    errors::Uln302Error,
    events::{DefaultReceiveUlnConfigsSet, PayloadVerified, ReceiveUlnConfigSet},
    interfaces::{IReceiveUln302, OAppUlnConfig, SetDefaultUlnConfigParam, UlnConfig},
    storage::UlnStorage,
};
use common_macros::{contract_impl, only_auth};
use endpoint_v2::{util, LayerZeroEndpointV2Client, Origin};
use message_lib_common::packet_codec_v1::{self, PacketHeader};
use soroban_sdk::{address_payload::AddressPayload, assert_with_error, Address, Bytes, BytesN, Env, Vec};
use utils::option_ext::OptionExt;

// ============================================================================================
// IReceiveUln302 Contract Implementation
// ============================================================================================

#[contract_impl]
impl IReceiveUln302 for Uln302 {
    /// Called by a DVN to verify a message with a specific number of block confirmations.
    ///
    /// Stores the DVN's verification attestation which will be checked during commit_verification.
    fn verify(env: &Env, dvn: &Address, packet_header: &Bytes, payload_hash: &BytesN<32>, confirmations: u64) {
        dvn.require_auth();

        let header_hash = util::keccak256(env, packet_header);
        UlnStorage::set_confirmations(env, dvn, &header_hash, payload_hash, &confirmations);

        PayloadVerified {
            dvn: dvn.clone(),
            header: packet_header.clone(),
            proof_hash: payload_hash.clone(),
            confirmations,
        }
        .publish(env);
    }

    /// Permissionless function to commit a verified message to the endpoint after sufficient DVN verification.
    ///
    /// Validates the packet header and checks that enough DVNs have verified the message
    /// (all required DVNs + optional DVN threshold). Once verified, cleans up DVN confirmation
    /// storage and calls the endpoint to mark the message as verified and executable.
    fn commit_verification(env: &Env, packet_header: &Bytes, payload_hash: &BytesN<32>) {
        let (header, uln_config, receiver) = Self::decode_packet_header_with_config(env, packet_header);
        let header_hash = util::keccak256(env, packet_header);

        // check if the message is verifiable
        assert_with_error!(
            env,
            Self::verifiable_internal(env, &uln_config, &header_hash, payload_hash),
            Uln302Error::Verifying
        );

        // clean up confirmations storage for all DVNs
        uln_config.required_dvns.iter().chain(uln_config.optional_dvns.iter()).for_each(|dvn| {
            UlnStorage::remove_confirmations(env, &dvn, &header_hash, payload_hash);
        });

        // commit verification to the endpoint
        LayerZeroEndpointV2Client::new(env, &Self::endpoint(env)).verify(
            &env.current_contract_address(),
            &Origin { src_eid: header.src_eid, sender: header.sender, nonce: header.nonce },
            &receiver,
            payload_hash,
        );
    }

    // ============================================================================================
    // Owner Set Config Functions
    // ============================================================================================

    /// Sets default receive ULN configurations for multiple source endpoints.
    ///
    /// Validates each config and stores it as the default for the specified source EID.
    #[only_auth]
    fn set_default_receive_uln_configs(env: &Env, params: &Vec<SetDefaultUlnConfigParam>) {
        for param in params {
            param.config.validate_default_config(env);
            UlnStorage::set_default_receive_uln_configs(env, param.eid, &param.config);
        }
        DefaultReceiveUlnConfigsSet { params: params.clone() }.publish(env);
    }

    // ============================================================================================
    // View Functions
    // ============================================================================================

    /// Returns the number of block confirmations a DVN has submitted for a specific message.
    fn confirmations(env: &Env, dvn: &Address, header_hash: &BytesN<32>, payload_hash: &BytesN<32>) -> Option<u64> {
        UlnStorage::confirmations(env, dvn, header_hash, payload_hash)
    }

    /// Checks if a message has been sufficiently verified by DVNs and is ready to commit.
    fn verifiable(env: &Env, packet_header: &Bytes, payload_hash: &BytesN<32>) -> bool {
        let (_, uln_config, _) = Self::decode_packet_header_with_config(env, packet_header);
        Self::verifiable_internal(env, &uln_config, &util::keccak256(env, packet_header), payload_hash)
    }

    /// Returns the default receive ULN configuration for a source endpoint.
    fn default_receive_uln_config(env: &Env, src_eid: u32) -> Option<UlnConfig> {
        UlnStorage::default_receive_uln_configs(env, src_eid)
    }

    /// Returns the OApp-specific receive ULN configuration override for a source endpoint.
    fn oapp_receive_uln_config(env: &Env, receiver: &Address, src_eid: u32) -> Option<OAppUlnConfig> {
        UlnStorage::oapp_receive_uln_configs(env, receiver, src_eid)
    }

    /// Returns the effective receive ULN configuration by merging OApp config with defaults.
    fn effective_receive_uln_config(env: &Env, receiver: &Address, src_eid: u32) -> UlnConfig {
        let default_config = Self::default_receive_uln_config(env, src_eid)
            .unwrap_or_panic(env, Uln302Error::DefaultReceiveUlnConfigNotFound);
        let oapp_config = Self::oapp_receive_uln_config(env, receiver, src_eid).unwrap_or(OAppUlnConfig::default(env));

        let effective_config = oapp_config.apply_default_config(&default_config);
        effective_config.validate_at_least_one_dvn(env); // validate the final config

        effective_config
    }
}

// ============================================================================================
// Internal Functions
// ============================================================================================

impl Uln302 {
    /// Sets or removes OApp-specific receive ULN config.
    ///
    /// If `config` is `None`, the OApp-specific config is removed (falling back to defaults).
    /// Panics if the final effective config is invalid.
    pub(super) fn set_receive_uln_config(env: &Env, receiver: &Address, src_eid: u32, config: &Option<OAppUlnConfig>) {
        if let Some(c) = config {
            c.validate_oapp_config(env);
        }
        UlnStorage::set_or_remove_oapp_receive_uln_configs(env, receiver, src_eid, config);
        // validate the config by getting the effective config
        let _ = Self::effective_receive_uln_config(env, receiver, src_eid);

        ReceiveUlnConfigSet { receiver: receiver.clone(), src_eid, config: config.clone() }.publish(env);
    }

    // ============================================================================================
    // Verification Helpers Functions
    // ============================================================================================

    /// Decodes packet header and returns header, effective ULN config, and receiver address.
    fn decode_packet_header_with_config(env: &Env, packet_header: &Bytes) -> (PacketHeader, UlnConfig, Address) {
        let header = packet_codec_v1::decode_packet_header(env, packet_header);
        assert_with_error!(
            env,
            header.dst_eid == LayerZeroEndpointV2Client::new(env, &Self::endpoint(env)).eid(),
            Uln302Error::InvalidEID
        );

        // convert the receiver address from BytesN<32> to ContractAddress
        let receiver = Address::from_payload(env, AddressPayload::ContractIdHash(header.receiver.clone()));
        let uln_config = Self::effective_receive_uln_config(env, &receiver, header.src_eid);

        (header, uln_config, receiver)
    }

    /// Checks if all required DVNs verified and optional DVN threshold is met.
    ///
    /// Returns true if the message has been verified by enough DVNs to be committed, false otherwise
    fn verifiable_internal(
        env: &Env,
        uln_config: &UlnConfig,
        header_hash: &BytesN<32>,
        payload_hash: &BytesN<32>,
    ) -> bool {
        let threshold = uln_config.optional_dvn_threshold as usize;
        let is_verified = |dvn: &Address| Self::verified(env, dvn, header_hash, payload_hash, uln_config.confirmations);

        // All required DVNs must be verified AND at least `threshold` optional DVNs must be verified
        let all_required_verified = uln_config.required_dvns.iter().all(|dvn| is_verified(&dvn));
        let optional_threshold_met =
            uln_config.optional_dvns.iter().filter(is_verified).take(threshold).count() == threshold;
        all_required_verified && optional_threshold_met
    }

    /// Checks if a DVN has submitted enough confirmations for the message.
    ///
    /// Returns true if the DVN has submitted enough confirmations for the message, false otherwise
    fn verified(
        env: &Env,
        dvn: &Address,
        header_hash: &BytesN<32>,
        payload_hash: &BytesN<32>,
        required_confirmations: u64,
    ) -> bool {
        Self::confirmations(env, dvn, header_hash, payload_hash).map(|c| c >= required_confirmations).unwrap_or(false)
    }
}
