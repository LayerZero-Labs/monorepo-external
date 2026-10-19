use super::{Uln302, Uln302Args, Uln302Client};
use crate::{
    errors::Uln302Error,
    events::{
        DVNFeePaid, DefaultExecutorConfigsSet, DefaultSendUlnConfigsSet, ExecutorConfigSet, ExecutorFeePaid,
        SendUlnConfigSet,
    },
    interfaces::{
        ExecutorConfig, ISendUln302, OAppExecutorConfig, OAppUlnConfig, SetDefaultExecutorConfigParam,
        SetDefaultUlnConfigParam, UlnConfig,
    },
    storage::UlnStorage,
};
use common_macros::{contract_impl, only_auth};
use endpoint_v2::{FeeRecipient, FeesAndPacket, ISendLib, MessagingFee, OutboundPacket};
use message_lib_common::{
    interfaces::{LayerZeroDVNClient, LayerZeroExecutorClient, LayerZeroTreasuryClient},
    packet_codec_v1, worker_options,
};
use soroban_sdk::{
    address_payload::AddressPayload, assert_with_error, bytes, vec, Address, Bytes, BytesN, Env, Map, Vec,
};
use utils::option_ext::OptionExt;

// ==============================================================================
// ISendLib Contract Implementation
// ==============================================================================

#[contract_impl]
impl ISendLib for Uln302 {
    /// Quotes the total fee for sending a cross-chain message.
    ///
    /// Calculates fees from: executor (message execution), DVNs (verification), and treasury (protocol fee).
    fn quote(env: &Env, packet: &OutboundPacket, options: &Bytes, pay_in_zro: bool) -> MessagingFee {
        let (executor_options, dvn_options, packet_header, payload_hash) =
            prepare_packet_and_options(env, packet, options);

        // Executor fee
        let executor_fee =
            Self::quote_executor(env, &packet.sender, packet.dst_eid, packet.message.len(), &executor_options);

        // DVNs fees
        let dvns_fee =
            Self::quote_dvns(env, &packet.sender, packet.dst_eid, &packet_header, &payload_hash, &dvn_options);

        // Treasury fee
        let workers_fee = executor_fee + dvns_fee;
        let (_, treasury_fee) = Self::quote_treasury(env, &packet.sender, packet.dst_eid, workers_fee, pay_in_zro);

        if pay_in_zro {
            MessagingFee { native_fee: workers_fee, zro_fee: treasury_fee }
        } else {
            MessagingFee { native_fee: workers_fee + treasury_fee, zro_fee: 0 }
        }
    }

    /// Sends a cross-chain message and returns fee recipients for payment.
    ///
    /// Assigns executor and DVNs, calculates fees, and encodes the packet for transmission.
    fn send(env: &Env, packet: &OutboundPacket, options: &Bytes, pay_in_zro: bool) -> FeesAndPacket {
        Self::endpoint(env).require_auth();

        let (executor_options, dvn_options, packet_header, payload_hash) =
            prepare_packet_and_options(env, packet, options);

        // Executor fee
        let executor_fee_recipient = Self::assign_executor(
            env,
            &packet.guid,
            &packet.sender,
            packet.dst_eid,
            packet.message.len(),
            &executor_options,
        );

        // DVNs fees
        let dvns_fee_recipients = Self::assign_dvns(
            env,
            &packet.guid,
            &packet.sender,
            packet.dst_eid,
            &packet_header,
            &payload_hash,
            &dvn_options,
        );

        // Collect all worker fees
        let mut native_fee_recipients = vec![env, executor_fee_recipient];
        native_fee_recipients.extend(dvns_fee_recipients.iter());

        // Treasury fee
        let total_worker_fee = native_fee_recipients.iter().map(|fee| fee.amount).sum();
        let (treasury_addr, treasury_fee) =
            Self::quote_treasury(env, &packet.sender, packet.dst_eid, total_worker_fee, pay_in_zro);

        // Handle ZRO fee recipients
        let mut zro_fee_recipients = vec![env];
        if treasury_fee != 0 {
            // The treasury contract address is used as the fixed fee recipient (rather than allowing
            // the treasury admin to configure a custom receiver). This is because a malicious treasury
            // admin could set the recipient to an address that has not been created/initialized on Stellar.
            // On Stellar, uninitialized accounts cannot receive any tokens, including native XLM. This
            // would cause all fee payments to fail, effectively DOSing the OApp. Using the contract
            // address ensures the recipient is always valid and can receive tokens.
            let treasury_fee_recipient = FeeRecipient { to: treasury_addr, amount: treasury_fee };
            if pay_in_zro {
                zro_fee_recipients.push_back(treasury_fee_recipient);
            } else {
                native_fee_recipients.push_back(treasury_fee_recipient);
            }
        }

        FeesAndPacket {
            native_fee_recipients,
            zro_fee_recipients,
            encoded_packet: packet_codec_v1::encode_packet(env, packet),
        }
    }
}

// ==============================================================================
// ISendUln302 Contract Implementation
// ==============================================================================

#[contract_impl]
impl ISendUln302 for Uln302 {
    /// Sets default executor configurations for multiple destination endpoints.
    #[only_auth]
    fn set_default_executor_configs(env: &Env, params: &Vec<SetDefaultExecutorConfigParam>) {
        for param in params {
            param.config.validate_default_config(env);
            UlnStorage::set_default_executor_configs(env, param.dst_eid, &param.config);
        }
        DefaultExecutorConfigsSet { params: params.clone() }.publish(env);
    }

    /// Sets default send ULN configurations for multiple destination endpoints.
    #[only_auth]
    fn set_default_send_uln_configs(env: &Env, params: &Vec<SetDefaultUlnConfigParam>) {
        for param in params {
            param.config.validate_default_config(env);
            UlnStorage::set_default_send_uln_configs(env, param.eid, &param.config);
        }
        DefaultSendUlnConfigsSet { params: params.clone() }.publish(env);
    }

    // ============================================================================================
    // View Functions
    // ============================================================================================

    /// Returns the treasury address for fee collection.
    fn treasury(env: &Env) -> Address {
        // This is safe because the treasury is set in the constructor.
        UlnStorage::treasury(env).unwrap()
    }

    /// Returns the default executor configuration for a destination endpoint.
    fn default_executor_config(env: &Env, dst_eid: u32) -> Option<ExecutorConfig> {
        UlnStorage::default_executor_configs(env, dst_eid)
    }

    /// Returns the OApp-specific executor configuration for a destination endpoint.
    fn oapp_executor_config(env: &Env, sender: &Address, dst_eid: u32) -> Option<OAppExecutorConfig> {
        UlnStorage::oapp_executor_configs(env, sender, dst_eid)
    }

    /// Returns the effective executor configuration by merging OApp config with default.
    fn effective_executor_config(env: &Env, sender: &Address, dst_eid: u32) -> ExecutorConfig {
        let default_config = Self::default_executor_config(env, dst_eid)
            .unwrap_or_panic(env, Uln302Error::DefaultExecutorConfigNotFound);
        let oapp_config = Self::oapp_executor_config(env, sender, dst_eid).unwrap_or_default();

        oapp_config.apply_default_config(&default_config)
    }

    /// Returns the default send ULN configuration for a destination endpoint.
    fn default_send_uln_config(env: &Env, dst_eid: u32) -> Option<UlnConfig> {
        UlnStorage::default_send_uln_configs(env, dst_eid)
    }

    /// Returns the OApp-specific send ULN configuration for a destination endpoint.
    fn oapp_send_uln_config(env: &Env, sender: &Address, dst_eid: u32) -> Option<OAppUlnConfig> {
        UlnStorage::oapp_send_uln_configs(env, sender, dst_eid)
    }

    /// Returns the effective send ULN configuration by merging OApp config with default.
    fn effective_send_uln_config(env: &Env, sender: &Address, dst_eid: u32) -> UlnConfig {
        let default_config =
            Self::default_send_uln_config(env, dst_eid).unwrap_or_panic(env, Uln302Error::DefaultSendUlnConfigNotFound);
        let oapp_config = Self::oapp_send_uln_config(env, sender, dst_eid).unwrap_or(OAppUlnConfig::default(env));

        let effective_config = oapp_config.apply_default_config(&default_config);
        effective_config.validate_at_least_one_dvn(env); // validate the final config

        effective_config
    }
}

// ==============================================================================
// Internal Functions
// ==============================================================================

impl Uln302 {
    /// Sets or removes OApp-specific executor configuration for a destination endpoint.
    ///
    /// If `config` is `None`, the OApp-specific config is removed (falling back to defaults).
    pub(super) fn set_executor_config(env: &Env, sender: &Address, dst_eid: u32, config: &Option<OAppExecutorConfig>) {
        UlnStorage::set_or_remove_oapp_executor_configs(env, sender, dst_eid, config);
        ExecutorConfigSet { sender: sender.clone(), dst_eid, config: config.clone() }.publish(env);
    }

    /// Sets or removes OApp-specific send ULN configuration for a destination endpoint.
    ///
    /// If `config` is `None`, the OApp-specific config is removed (falling back to defaults).
    /// Panics if the final effective config is invalid.
    pub(super) fn set_send_uln_config(env: &Env, sender: &Address, dst_eid: u32, config: &Option<OAppUlnConfig>) {
        if let Some(c) = config {
            c.validate_oapp_config(env);
        }
        UlnStorage::set_or_remove_oapp_send_uln_configs(env, sender, dst_eid, config);
        // validate the config by getting the effective config
        let _ = Self::effective_send_uln_config(env, sender, dst_eid);

        SendUlnConfigSet { sender: sender.clone(), dst_eid, config: config.clone() }.publish(env);
    }

    // ============================================================================================
    // Quote Fee Functions
    // ============================================================================================

    /// Quotes the executor fee for message execution.
    fn quote_executor(env: &Env, sender: &Address, dst_eid: u32, message_size: u32, options: &Bytes) -> i128 {
        // Get the effective executor config and validate message size
        let executor_config = Self::effective_executor_config(env, sender, dst_eid);
        assert_with_error!(env, message_size <= executor_config.max_message_size, Uln302Error::InvalidMessageSize);

        let executor_client = LayerZeroExecutorClient::new(env, &executor_config.executor);
        let fee = executor_client.get_fee(&env.current_contract_address(), sender, &dst_eid, &message_size, options);
        assert_with_error!(env, fee >= 0, Uln302Error::InvalidFee);
        fee
    }

    /// Quotes the total DVN fees for message verification.
    fn quote_dvns(
        env: &Env,
        sender: &Address,
        dst_eid: u32,
        packet_header: &Bytes,
        payload_hash: &BytesN<32>,
        dvn_options: &Map<u32, Bytes>,
    ) -> i128 {
        let uln_config = Self::effective_send_uln_config(env, sender, dst_eid);
        let send_lib = env.current_contract_address();
        let confirmations = uln_config.confirmations;
        uln_config
            .required_dvns
            .iter()
            .chain(uln_config.optional_dvns.iter())
            .enumerate()
            .map(|(idx, dvn_addr)| {
                let dvn_client = LayerZeroDVNClient::new(env, &dvn_addr);
                let dvn_opts = dvn_options.get(idx as u32).unwrap_or(bytes!(env));
                let fee = dvn_client.get_fee(
                    &send_lib,
                    sender,
                    &dst_eid,
                    packet_header,
                    payload_hash,
                    &confirmations,
                    &dvn_opts,
                );
                assert_with_error!(env, fee >= 0, Uln302Error::InvalidFee);
                fee
            })
            .sum()
    }

    /// Quotes the treasury fee for the protocol.
    fn quote_treasury(
        env: &Env,
        sender: &Address,
        dst_eid: u32,
        workers_fee: i128,
        pay_in_zro: bool,
    ) -> (Address, i128) {
        let treasury_addr = Self::treasury(env);
        let treasury_fee =
            LayerZeroTreasuryClient::new(env, &treasury_addr).get_fee(sender, &dst_eid, &workers_fee, &pay_in_zro);
        assert_with_error!(env, treasury_fee >= 0, Uln302Error::InvalidFee);
        (treasury_addr, treasury_fee)
    }

    // ============================================================================================
    // Assign Job Functions
    // ============================================================================================

    /// Assigns an executor job and returns the fee recipient.
    fn assign_executor(
        env: &Env,
        guid: &BytesN<32>,
        sender: &Address,
        dst_eid: u32,
        message_size: u32,
        options: &Bytes,
    ) -> FeeRecipient {
        // Get the effective executor config and validate message size
        let executor_config = Self::effective_executor_config(env, sender, dst_eid);
        assert_with_error!(env, message_size <= executor_config.max_message_size, Uln302Error::InvalidMessageSize);

        let executor_client = LayerZeroExecutorClient::new(env, &executor_config.executor);
        let recipient =
            executor_client.assign_job(&env.current_contract_address(), sender, &dst_eid, &message_size, options);
        assert_with_error!(env, recipient.amount >= 0, Uln302Error::InvalidFee);

        ExecutorFeePaid { guid: guid.clone(), executor: executor_client.address.clone(), fee: recipient.clone() }
            .publish(env);
        recipient
    }

    /// Assigns DVN jobs and returns fee recipients for all DVNs.
    fn assign_dvns(
        env: &Env,
        guid: &BytesN<32>,
        sender: &Address,
        dst_eid: u32,
        packet_header: &Bytes,
        payload_hash: &BytesN<32>,
        dvn_options: &Map<u32, Bytes>,
    ) -> Vec<FeeRecipient> {
        let uln_config = Self::effective_send_uln_config(env, sender, dst_eid);
        let send_lib = env.current_contract_address();
        let confirmations = uln_config.confirmations;

        let mut dvns = vec![env];
        let mut fees = vec![env];
        for (idx, dvn_addr) in uln_config.required_dvns.iter().chain(uln_config.optional_dvns.iter()).enumerate() {
            let dvn_client = LayerZeroDVNClient::new(env, &dvn_addr);
            let dvn_opts = dvn_options.get(idx as u32).unwrap_or(bytes!(env));
            let dvn_fee_recipient = dvn_client.assign_job(
                &send_lib,
                sender,
                &dst_eid,
                packet_header,
                payload_hash,
                &confirmations,
                &dvn_opts,
            );
            assert_with_error!(env, dvn_fee_recipient.amount >= 0, Uln302Error::InvalidFee);
            fees.push_back(dvn_fee_recipient);
            dvns.push_back(dvn_addr);
        }

        DVNFeePaid { guid: guid.clone(), dvns, fees: fees.clone() }.publish(env);
        fees
    }
}

// ==============================================================================
// Helper Functions
// ==============================================================================

/// Prepares common packet and options needed for both quote and send flows.
///
/// Returns a tuple of (executor_options, dvn_options, packet_header, payload_hash)
fn prepare_packet_and_options(
    env: &Env,
    packet: &OutboundPacket,
    options: &Bytes,
) -> (Bytes, Map<u32, Bytes>, Bytes, BytesN<32>) {
    // Only allow contract addresses (C-addresses) as senders
    assert_with_error!(
        env,
        matches!(packet.sender.to_payload(), Some(AddressPayload::ContractIdHash(_))),
        Uln302Error::InvalidSenderAddress
    );

    let (executor_options, dvn_options) = worker_options::split_worker_options(env, options);
    let packet_header = packet_codec_v1::encode_packet_header(env, packet);
    let payload_hash = packet_codec_v1::payload_hash(env, packet);
    (executor_options, dvn_options, packet_header, payload_hash)
}
