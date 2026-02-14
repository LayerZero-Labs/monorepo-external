//! Ultra light node component implementation

#[starknet::contract]
pub mod UltraLightNode302 {
    use core::cmp::{max, min};
    use core::dict::Felt252DictEntryTrait;
    use core::num::traits::Zero;
    use lz_utils::bytes::Bytes32;
    use lz_utils::error::assert_with_byte_array;
    use lz_utils::keccak::keccak256;
    use openzeppelin::access::ownable::OwnableComponent;
    use starknet::storage::{
        Map, Mutable, StoragePath, StoragePathEntry, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use crate::common::constants::ZERO_ADDRESS;
    use crate::common::packet_v1_codec::PacketV1Codec;
    use crate::common::structs::messaging::{
        MessageLibSendResult, MessageReceipt, MessagingFee, Payee,
    };
    use crate::common::structs::packet::{Origin, Packet, PacketHeader};
    use crate::endpoint::constants::EMPTY_PAYLOAD_HASH;
    use crate::endpoint::interfaces::endpoint_v2::{
        IEndpointV2Dispatcher, IEndpointV2DispatcherTrait, IEndpointV2SafeDispatcher,
        IEndpointV2SafeDispatcherTrait,
    };
    use crate::endpoint::messaging_channel::interface::{
        IMessagingChannelDispatcher, IMessagingChannelDispatcherTrait,
    };
    use crate::message_lib::interface::{IMessageLib, VerificationState};
    use crate::message_lib::structs::{MessageLibType, MessageLibVersion, SetConfigParam};
    use crate::message_lib::uln_302::errors::{
        err_caller_not_endpoint, err_invalid_config_type, err_invalid_executor,
        err_invalid_treasury_native_fee_cap, err_message_too_large, err_uln_verifying,
        err_unsupported_receive_eid, err_unsupported_send_eid, err_zero_message_size,
    };
    use crate::message_lib::uln_302::events::{
        DefaultExecutorConfigsSet, DefaultUlnReceiveConfigsSet, DefaultUlnSendConfigsSet,
        DvnFeesPaid, ExecutorFeePaid, OAppExecutorConfigSet, OAppUlnReceiveConfigSet,
        OAppUlnSendConfigSet, PayloadVerified, TreasuryFeePaid, TreasuryNativeFeeCapSet,
    };
    use crate::message_lib::uln_302::interface::IUltraLightNode302Admin;
    use crate::message_lib::uln_302::options::split_options;
    use crate::message_lib::uln_302::structs::executor_config::{
        ExecutorConfig, ExecutorConfigResolverImpl, SetDefaultExecutorConfigParam,
    };
    use crate::message_lib::uln_302::structs::payment_info::DvnPaymentInfo;
    use crate::message_lib::uln_302::structs::uln_config::{
        SetDefaultUlnConfigParam, UlnConfig, UlnConfigUtilsImpl,
    };
    use crate::message_lib::uln_302::structs::uln_config_storage_node::{
        UlnConfigStorageNode, UlnConfigStorageNodeTrait,
    };
    use crate::message_lib::uln_302::structs::verification::Verification;
    use crate::treasury::interfaces::layerzero_treasury::{
        ILayerZeroTreasuryDispatcher, ILayerZeroTreasuryDispatcherTrait,
    };
    use crate::workers::base::structs::QuoteParams;
    use crate::workers::dvn::options::group_dvn_options_by_idx;
    use crate::workers::interface::{ILayerZeroWorkerDispatcher, ILayerZeroWorkerDispatcherTrait};

    // Default configuration address
    const DEFAULT_CONFIG: ContractAddress = ZERO_ADDRESS;

    // Config type constants
    pub const CONFIG_TYPE_EXECUTOR: u32 = 1;
    pub const CONFIG_TYPE_ULN: u32 = 2;

    // Empty verification, equivalent to Default::default() but more explicit
    pub const EMPTY_VERIFICATION: Verification = Verification {
        submitted: false, confirmations: 0,
    };

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    // Ownable Mixin
    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        // Send-side storage items:
        // sender => dst_eid => UlnConfig
        send_configs: Map<ContractAddress, Map<u32, UlnConfigStorageNode>>,
        executor_configs: Map<ContractAddress, Map<u32, ExecutorConfig>>,
        treasury: ContractAddress,
        endpoint: ContractAddress,
        treasury_native_fee_cap: u256,
        // Receive-side storage items:
        // headerHash => payloadHash => dvn => Verification
        hash_lookup: Map<Bytes32, Map<Bytes32, Map<ContractAddress, Verification>>>,
        // receiver => src_eid => UlnConfig
        receive_configs: Map<ContractAddress, Map<u32, UlnConfigStorageNode>>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        DefaultUlnSendConfigsSet: DefaultUlnSendConfigsSet,
        DefaultUlnReceiveConfigsSet: DefaultUlnReceiveConfigsSet,
        OAppUlnSendConfigSet: OAppUlnSendConfigSet,
        OAppUlnReceiveConfigSet: OAppUlnReceiveConfigSet,
        DefaultExecutorConfigsSet: DefaultExecutorConfigsSet,
        OAppExecutorConfigSet: OAppExecutorConfigSet,
        DvnFeesPaid: DvnFeesPaid,
        ExecutorFeePaid: ExecutorFeePaid,
        TreasuryFeePaid: TreasuryFeePaid,
        TreasuryNativeFeeCapSet: TreasuryNativeFeeCapSet,
        PayloadVerified: PayloadVerified,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        treasury: ContractAddress,
        endpoint: ContractAddress,
        treasury_native_fee_cap: u256,
    ) {
        self.ownable.initializer(owner);
        self.treasury.write(treasury);
        self.endpoint.write(endpoint);
        self.treasury_native_fee_cap.write(treasury_native_fee_cap);
    }

    #[abi(embed_v0)]
    impl UltraLightNode302Impl of IMessageLib<ContractState> {
        fn send(
            ref self: ContractState, packet: Packet, options: ByteArray, pay_in_lz_token: bool,
        ) -> MessageLibSendResult {
            // Assert onlyEndpointV2
            self._assert_only_endpoint();
            let sender = packet.sender;

            let (executor_options, dvn_options) = split_options(@options);
            let uln_config = self.get_oapp_uln_send_config(packet.sender, packet.dst_eid);

            let packet_header = PacketHeader {
                nonce: packet.nonce,
                src_eid: packet.src_eid,
                sender: packet.sender,
                dst_eid: packet.dst_eid,
                receiver: packet.receiver,
            };

            // pay DVNs
            let DvnPaymentInfo {
                mut payees, mut total_native_fee,
            } = self._pay_dvns(@uln_config, dvn_options, @packet);
            self
                .emit(
                    DvnFeesPaid {
                        oapp: sender, payees: payees.clone(), packet_header: packet_header.clone(),
                    },
                );

            // pay executor
            let executor_payee = self._pay_executor(@uln_config, executor_options, @packet);
            total_native_fee += executor_payee.native_amount;
            payees.append(executor_payee.clone());
            self
                .emit(
                    ExecutorFeePaid {
                        oapp: sender, payee: executor_payee, packet_header: packet_header.clone(),
                    },
                );

            // pay treasury
            let treasury_payee = self._pay_treasury(@packet, total_native_fee, pay_in_lz_token);
            payees.append(treasury_payee.clone());
            self.emit(TreasuryFeePaid { oapp: sender, payee: treasury_payee, packet_header });

            MessageLibSendResult {
                message_receipt: MessageReceipt { guid: packet.guid, nonce: packet.nonce, payees },
                encoded_packet: PacketV1Codec::encode(@packet),
            }
        }

        fn verify(
            ref self: ContractState,
            packet_header: ByteArray,
            payload_hash: Bytes32,
            confirmations: u64,
        ) {
            let dvn = get_caller_address();
            let header_hash = keccak256(@packet_header);

            // Store the verification: hashLookup[headerHash][payloadHash][dvn] = Verification
            self
                ._hash_lookup_entry(header_hash, payload_hash, dvn)
                .write(Verification { submitted: true, confirmations });

            // Emit PayloadVerified event
            self
                .emit(
                    PayloadVerified {
                        dvn,
                        header: packet_header,
                        confirmations: confirmations.into(),
                        proof_hash: payload_hash,
                    },
                );
        }

        fn commit(ref self: ContractState, packet_header: ByteArray, payload_hash: Bytes32) {
            let endpoint_dispatcher = IEndpointV2Dispatcher {
                contract_address: self.endpoint.read(),
            };

            // Validate the packet header
            PacketV1Codec::assert_header(@packet_header, endpoint_dispatcher.get_eid());

            // Extract receiver and src_eid from packet header
            let receiver = PacketV1Codec::receiver_address(@packet_header);
            let src_eid = PacketV1Codec::src_eid(@packet_header);

            // Get the receive configuration for this path
            let config = self.get_oapp_uln_receive_config(receiver, src_eid);

            // Verify and reclaim storage
            self._verify_and_reclaim_storage(@config, keccak256(@packet_header), payload_hash);

            // Create Origin struct for endpoint.verify
            let origin = Origin {
                src_eid,
                sender: PacketV1Codec::sender(@packet_header),
                nonce: PacketV1Codec::nonce(@packet_header),
            };

            // Call endpoint to verify and store the payload hash
            endpoint_dispatcher.verify(origin, receiver, payload_hash);
        }

        fn quote(
            self: @ContractState, packet: Packet, options: ByteArray, pay_in_lz_token: bool,
        ) -> MessagingFee {
            let (executor_options, dvn_options) = split_options(@options);

            let uln_config = self.get_oapp_uln_send_config(packet.sender, packet.dst_eid);

            let native_fee = self._quote_dvns(@uln_config, dvn_options, @packet)
                + self._quote_executor(@uln_config, executor_options, @packet);
            let treasury_payee = self._quote_treasury(@packet, native_fee, pay_in_lz_token);

            MessagingFee {
                native_fee: native_fee + treasury_payee.native_amount,
                lz_token_fee: treasury_payee.lz_token_amount,
            }
        }

        fn version(self: @ContractState) -> MessageLibVersion {
            MessageLibVersion { minor: 3, major: 0, endpoint_version: 2 }
        }

        fn message_lib_type(self: @ContractState) -> MessageLibType {
            MessageLibType::SendAndReceive
        }

        /// @dev a supported Eid must have a valid default uln config, which has at least one dvn
        fn is_supported_send_eid(self: @ContractState, dst_eid: u32) -> bool {
            let default_config = self.get_default_uln_send_config(dst_eid);

            let required_count = default_config.required_dvns.len();
            let optional_threshold = default_config.optional_dvn_threshold;

            required_count > 0 || optional_threshold > 0
        }

        /// @dev a supported receive Eid must have a valid default uln receive config, which has at
        /// least one dvn
        fn is_supported_receive_eid(self: @ContractState, src_eid: u32) -> bool {
            let default_config = self.get_default_uln_receive_config(src_eid);

            let required_count = default_config.required_dvns.len();
            let optional_threshold = default_config.optional_dvn_threshold;

            required_count > 0 || optional_threshold > 0
        }

        fn set_send_configs(
            ref self: ContractState, oapp: ContractAddress, params: Array<SetConfigParam>,
        ) {
            self._assert_only_endpoint();

            for param in params.into_iter() {
                // only allow it to happen if there is a default config for the eid
                self._assert_supported_send_eid(param.eid);

                if param.config_type == CONFIG_TYPE_EXECUTOR {
                    let mut config_span = param.config.span();
                    let config: ExecutorConfig = Serde::deserialize(ref config_span).unwrap();
                    self._set_oapp_executor_config(oapp, param.eid, config);
                } else {
                    assert_with_byte_array(
                        param.config_type == CONFIG_TYPE_ULN,
                        err_invalid_config_type(param.config_type),
                    );
                    let mut config_span = param.config.span();
                    let config: UlnConfig = Serde::deserialize(ref config_span).unwrap();
                    self._set_oapp_uln_send_config(oapp, param.eid, config);
                }
            }
        }

        fn get_send_config(
            self: @ContractState, eid: u32, oapp: ContractAddress, config_type: u32,
        ) -> Array<felt252> {
            let mut serialized = array![];
            if config_type == CONFIG_TYPE_EXECUTOR {
                let config = self.get_oapp_executor_config(oapp, eid);
                Serde::serialize(@config, ref serialized);
            } else {
                assert_with_byte_array(
                    config_type == CONFIG_TYPE_ULN, err_invalid_config_type(config_type),
                );
                let config = self.get_oapp_uln_send_config(oapp, eid);
                Serde::serialize(@config, ref serialized);
            }
            serialized
        }

        fn set_receive_configs(
            ref self: ContractState, oapp: ContractAddress, params: Array<SetConfigParam>,
        ) {
            self._assert_only_endpoint();

            for param in params.into_iter() {
                // only allow it to happen if there is a default config for the eid
                self._assert_supported_receive_eid(param.eid);

                assert_with_byte_array(
                    param.config_type == CONFIG_TYPE_ULN,
                    err_invalid_config_type(param.config_type),
                );

                let mut config_span = param.config.span();
                let config: UlnConfig = Serde::deserialize(ref config_span).unwrap();
                self._set_oapp_uln_receive_config(oapp, param.eid, config);
            }
        }

        fn get_receive_config(
            self: @ContractState, eid: u32, oapp: ContractAddress, config_type: u32,
        ) -> Array<felt252> {
            let mut serialized = array![];
            assert_with_byte_array(
                config_type == CONFIG_TYPE_ULN, err_invalid_config_type(config_type),
            );
            let config = self.get_oapp_uln_receive_config(oapp, eid);
            Serde::serialize(@config, ref serialized);

            serialized
        }

        fn verifiable(
            self: @ContractState, packet_header: ByteArray, payload_hash: Bytes32,
        ) -> VerificationState {
            let endpoint_dispatcher = IEndpointV2Dispatcher {
                contract_address: self.endpoint.read(),
            };
            PacketV1Codec::assert_header(@packet_header, endpoint_dispatcher.get_eid());

            let receiver = PacketV1Codec::receiver_address(@packet_header);

            let src_eid = PacketV1Codec::src_eid(@packet_header);
            let sender = PacketV1Codec::sender(@packet_header);
            let nonce = PacketV1Codec::nonce(@packet_header);

            let origin = Origin { src_eid, sender, nonce };

            // check endpoint initializable
            if (!self._safe_endpoint_initializable(origin.clone(), receiver)) {
                return VerificationState::NotInitializable;
            }

            // check endpoint verifiable
            if !self._endpoint_verifiable(origin, receiver, payload_hash) {
                return VerificationState::Verified;
            }

            // check uln verifiable
            if self
                ._check_verifiable(
                    @self.get_oapp_uln_receive_config(receiver, src_eid),
                    keccak256(@packet_header),
                    payload_hash,
                ) {
                VerificationState::Verifiable
            } else {
                VerificationState::Verifying
            }
        }
    }

    // Admin functions for configuration management
    #[abi(embed_v0)]
    impl UltraLightNode302AdminImpl of IUltraLightNode302Admin<ContractState> {
        // =============================== ULN Config Setters ======================================

        fn set_default_uln_send_configs(
            ref self: ContractState, params: Array<SetDefaultUlnConfigParam>,
        ) {
            self.ownable.assert_only_owner();

            for param in @params {
                UlnConfigUtilsImpl::assert_valid_config(param.config);

                self
                    .send_configs
                    .entry(DEFAULT_CONFIG)
                    .entry(*param.eid)
                    .set_uln_config(param.config.clone());
            }

            self.emit(DefaultUlnSendConfigsSet { params });
        }

        fn set_default_uln_receive_configs(
            ref self: ContractState, params: Array<SetDefaultUlnConfigParam>,
        ) {
            self.ownable.assert_only_owner();

            for param in @params {
                UlnConfigUtilsImpl::assert_valid_config(param.config);

                self
                    .receive_configs
                    .entry(DEFAULT_CONFIG)
                    .entry(*param.eid)
                    .set_uln_config(param.config.clone());
            }

            self.emit(DefaultUlnReceiveConfigsSet { params });
        }

        // =============================== ULN Config Getters ======================================

        // Getter functions for testing and verification
        fn get_default_uln_send_config(self: @ContractState, dst_eid: u32) -> UlnConfig {
            self.send_configs.entry(DEFAULT_CONFIG).entry(dst_eid).get_uln_config()
        }

        fn get_default_uln_receive_config(self: @ContractState, src_eid: u32) -> UlnConfig {
            self.receive_configs.entry(DEFAULT_CONFIG).entry(src_eid).get_uln_config()
        }

        fn get_raw_oapp_uln_send_config(
            self: @ContractState, oapp: ContractAddress, dst_eid: u32,
        ) -> UlnConfig {
            self.send_configs.entry(oapp).entry(dst_eid).get_uln_config()
        }

        fn get_oapp_uln_send_config(
            self: @ContractState, oapp: ContractAddress, dst_eid: u32,
        ) -> UlnConfig {
            let default_config = self.get_default_uln_send_config(dst_eid);
            let raw_oapp_config = self.get_raw_oapp_uln_send_config(oapp, dst_eid);
            UlnConfigUtilsImpl::resolve(@default_config, @raw_oapp_config)
        }

        fn get_raw_oapp_uln_receive_config(
            self: @ContractState, oapp: ContractAddress, src_eid: u32,
        ) -> UlnConfig {
            self.receive_configs.entry(oapp).entry(src_eid).get_uln_config()
        }

        fn get_oapp_uln_receive_config(
            self: @ContractState, oapp: ContractAddress, src_eid: u32,
        ) -> UlnConfig {
            let default_config = self.get_default_uln_receive_config(src_eid);
            let raw_oapp_config = self.get_raw_oapp_uln_receive_config(oapp, src_eid);
            UlnConfigUtilsImpl::resolve(@default_config, @raw_oapp_config)
        }

        // =============================== Executor Config Setters ===============================

        fn set_default_executor_configs(
            ref self: ContractState, params: Array<SetDefaultExecutorConfigParam>,
        ) {
            self.ownable.assert_only_owner();

            for param in @params {
                assert_with_byte_array(param.config.executor.is_non_zero(), err_invalid_executor());
                assert_with_byte_array(
                    param.config.max_message_size.is_non_zero(), err_zero_message_size(),
                );

                self
                    .executor_configs
                    .entry(DEFAULT_CONFIG)
                    .entry(*param.dst_eid)
                    .write(param.config.clone());
            }

            self.emit(DefaultExecutorConfigsSet { params });
        }

        // =============================== Executor Config Getters ===============================

        fn get_default_executor_config(self: @ContractState, dst_eid: u32) -> ExecutorConfig {
            self.executor_configs.entry(DEFAULT_CONFIG).entry(dst_eid).read()
        }

        fn get_raw_oapp_executor_config(
            self: @ContractState, oapp: ContractAddress, dst_eid: u32,
        ) -> ExecutorConfig {
            self.executor_configs.entry(oapp).entry(dst_eid).read()
        }

        fn get_oapp_executor_config(
            self: @ContractState, oapp: ContractAddress, dst_eid: u32,
        ) -> ExecutorConfig {
            let default_config = self.get_default_executor_config(dst_eid);
            let raw_oapp_config = self.get_raw_oapp_executor_config(oapp, dst_eid);
            ExecutorConfigResolverImpl::resolve(@default_config, @raw_oapp_config)
        }

        // =============================== Treasury Config Setters ===============================

        fn set_treasury_native_fee_cap(ref self: ContractState, native_fee_cap: u256) {
            self.ownable.assert_only_owner();
            let old_cap = self.treasury_native_fee_cap.read();
            assert_with_byte_array(
                native_fee_cap < old_cap,
                err_invalid_treasury_native_fee_cap(old_cap, native_fee_cap),
            );
            self.treasury_native_fee_cap.write(native_fee_cap);
            self.emit(TreasuryNativeFeeCapSet { native_fee_cap });
        }

        // =============================== Treasury Config Getters ===============================

        fn get_treasury(self: @ContractState) -> ContractAddress {
            self.treasury.read()
        }

        fn get_treasury_native_fee_cap(self: @ContractState) -> u256 {
            self.treasury_native_fee_cap.read()
        }

        fn has_payload_signed(
            self: @ContractState, header_hash: Bytes32, payload_hash: Bytes32, dvn: ContractAddress,
        ) -> bool {
            self._hash_lookup(header_hash, payload_hash, dvn) != EMPTY_VERIFICATION
        }
    }

    #[generate_trait]
    impl UltraLightNode302InternalImpl of UltraLightNode302InternalTrait {
        fn _assert_supported_send_eid(self: @ContractState, dst_eid: u32) {
            assert_with_byte_array(
                self.is_supported_send_eid(dst_eid), err_unsupported_send_eid(dst_eid),
            );
        }

        fn _assert_supported_receive_eid(self: @ContractState, src_eid: u32) {
            assert_with_byte_array(
                self.is_supported_receive_eid(src_eid), err_unsupported_receive_eid(src_eid),
            );
        }

        /// Given a packet, return the dst_eid, sender, and message size
        fn _expand_packet(self: @ContractState, packet: @Packet) -> (u32, ContractAddress, u32) {
            (*packet.dst_eid, *packet.sender, packet.message.len())
        }

        /// Prepare quote parameters for DVNs.
        ///
        /// We first prepare the parameters as an array, and then either quote or pay the fee for
        /// each DVN in order to separate the immutable `_quote_dvns` and mutable `_pay_dvns`
        /// functions. Looping over all the DVNs twice would not cost too much gas since the total
        /// DVN count is limited in practice and loops are cheap compared to the other operations on
        /// the VM.
        fn _prepare_dvn_quotes(
            self: @ContractState, uln_config: @UlnConfig, options: ByteArray, packet: @Packet,
        ) -> Array<(ContractAddress, QuoteParams)> {
            let (dst_eid, sender, calldata_size) = self._expand_packet(packet);
            let mut dvn_options_dict = group_dvn_options_by_idx(@options);
            // Accumulate quote params for DVNs.
            let mut params_array = array![];

            let mut all_dvns = uln_config.required_dvns.clone();
            all_dvns.append_span(uln_config.optional_dvns.into());

            for (index, dvn) in all_dvns.into_iter().enumerate() {
                let (entry, dvn_options_nullable) = dvn_options_dict.entry(index.into());
                dvn_options_dict = entry.finalize(Default::default());

                params_array
                    .append(
                        (
                            dvn,
                            QuoteParams {
                                dst_eid,
                                confirmations: *uln_config.confirmations,
                                sender,
                                options: dvn_options_nullable.deref_or(Default::default()),
                                calldata_size,
                            },
                        ),
                    );
            }

            params_array
        }

        fn _quote_dvns(
            self: @ContractState, uln_config: @UlnConfig, options: ByteArray, packet: @Packet,
        ) -> u256 {
            let mut total_native_fee = 0;

            for (dvn, params) in self._prepare_dvn_quotes(uln_config, options, packet) {
                total_native_fee += ILayerZeroWorkerDispatcher { contract_address: dvn }
                    .quote(params);
            }

            total_native_fee
        }

        fn _pay_dvns(
            ref self: ContractState, uln_config: @UlnConfig, options: ByteArray, packet: @Packet,
        ) -> DvnPaymentInfo {
            let mut total_native_fee = 0;
            let mut payees = array![];

            for (dvn, params) in self._prepare_dvn_quotes(uln_config, options, packet) {
                let native_amount = ILayerZeroWorkerDispatcher { contract_address: dvn }
                    .assign_job(params);

                total_native_fee += native_amount;
                payees.append(Payee { receiver: dvn, native_amount, lz_token_amount: 0 });
            }

            DvnPaymentInfo { total_native_fee, payees }
        }

        fn _prepare_executor_quote(
            self: @ContractState,
            uln_config: @UlnConfig,
            options: ByteArray,
            packet: @Packet,
            executor_config: @ExecutorConfig,
        ) -> QuoteParams {
            self._verify_packet_size(packet, executor_config);
            let (dst_eid, sender, calldata_size) = self._expand_packet(packet);

            QuoteParams {
                dst_eid, sender, calldata_size, options, confirmations: *uln_config.confirmations,
            }
        }

        fn _quote_executor(
            self: @ContractState, uln_config: @UlnConfig, options: ByteArray, packet: @Packet,
        ) -> u256 {
            let executor_config = self.get_oapp_executor_config(*packet.sender, *packet.dst_eid);
            let params = self
                ._prepare_executor_quote(uln_config, options, packet, @executor_config);

            ILayerZeroWorkerDispatcher { contract_address: executor_config.executor }.quote(params)
        }

        fn _pay_executor(
            ref self: ContractState, uln_config: @UlnConfig, options: ByteArray, packet: @Packet,
        ) -> Payee {
            let executor_config = self.get_oapp_executor_config(*packet.sender, *packet.dst_eid);
            let params = self
                ._prepare_executor_quote(uln_config, options, packet, @executor_config);
            let native_amount = ILayerZeroWorkerDispatcher {
                contract_address: executor_config.executor,
            }
                .assign_job(params);

            Payee { receiver: executor_config.executor, native_amount, lz_token_amount: 0 }
        }

        fn _process_treasury_fee(
            self: @ContractState,
            treasury: ContractAddress,
            native_fee: u256,
            treasury_fee: u256,
            pay_in_lz_token: bool,
        ) -> Payee {
            let treasury_fee_capped = self
                ._apply_treasury_fee_cap(native_fee, treasury_fee, pay_in_lz_token);

            let (native_amount, lz_token_amount) = if pay_in_lz_token {
                (0, treasury_fee_capped)
            } else {
                (treasury_fee_capped, 0)
            };

            Payee { receiver: treasury, native_amount, lz_token_amount }
        }

        fn _quote_treasury(
            self: @ContractState, packet: @Packet, native_fee: u256, pay_in_lz_token: bool,
        ) -> Payee {
            let treasury = self.treasury.read();
            let (dst_eid, sender, _) = self._expand_packet(packet);
            let treasury_fee = ILayerZeroTreasuryDispatcher { contract_address: treasury }
                .get_fee(sender, dst_eid, native_fee, pay_in_lz_token);

            self._process_treasury_fee(treasury, native_fee, treasury_fee, pay_in_lz_token)
        }

        fn _pay_treasury(
            ref self: ContractState, packet: @Packet, native_fee: u256, pay_in_lz_token: bool,
        ) -> Payee {
            let treasury = self.treasury.read();
            let (dst_eid, sender, _) = self._expand_packet(packet);
            let treasury_fee = ILayerZeroTreasuryDispatcher { contract_address: treasury }
                .pay_fee(sender, dst_eid, native_fee, pay_in_lz_token);

            self._process_treasury_fee(treasury, native_fee, treasury_fee, pay_in_lz_token)
        }

        fn _apply_treasury_fee_cap(
            self: @ContractState, native_fee: u256, treasury_fee: u256, pay_in_lz_token: bool,
        ) -> u256 {
            if pay_in_lz_token {
                return treasury_fee;
            }

            // we must prevent high-treasuryFee Dos attack
            // nativeFee = min(treasureFeeQuote, maxNativeFee)
            // opportunistically raise the maxNativeFee to be the same as _totalNativeFee
            // can't use the _totalNativeFee alone because the oapp can use custom workers to force
            // the fee to 0.
            // maxNativeFee = max (_totalNativeFee, treasuryNativeFeeCap)
            let treasury_native_fee_cap = self.treasury_native_fee_cap.read();

            min(treasury_fee, max(native_fee, treasury_native_fee_cap))
        }

        // Asserts whether the packet has a valid size and returns the executor address if so
        fn _verify_packet_size(
            self: @ContractState, packet: @Packet, executor_config: @ExecutorConfig,
        ) {
            let packet_message_size = packet.message.len();
            let max_message_size = *executor_config.max_message_size;

            assert_with_byte_array(
                packet_message_size <= max_message_size,
                err_message_too_large(packet_message_size, max_message_size),
            );
        }

        fn _assert_only_endpoint(self: @ContractState) {
            let caller = get_caller_address();
            let endpoint = self.endpoint.read();
            assert_with_byte_array(caller == endpoint, err_caller_not_endpoint(caller, endpoint));
        }

        /// @dev checks for endpoint verifiable and endpoint has payload hash
        fn _endpoint_verifiable(
            self: @ContractState, origin: Origin, receiver: ContractAddress, payload_hash: Bytes32,
        ) -> bool {
            if payload_hash == EMPTY_PAYLOAD_HASH {
                return false;
            }

            let endpoint_dispatcher = IEndpointV2Dispatcher {
                contract_address: self.endpoint.read(),
            };
            let channel_dispatcher = IMessagingChannelDispatcher {
                contract_address: self.endpoint.read(),
            };

            // check endpoint verifiable (equivalent to verifiable in Cairo)
            if !endpoint_dispatcher
                .verifiable_with_receive_lib(origin.clone(), receiver, get_contract_address()) {
                return false;
            }

            // if endpoint.verifiable, also check if the payload hash matches
            // endpoint allows re-verify, check if this payload has already been verified
            channel_dispatcher
                .inbound_payload_hash(
                    receiver, origin.src_eid, origin.sender, origin.nonce,
                ) != payload_hash
        }

        #[feature("safe_dispatcher")]
        fn _safe_endpoint_initializable(
            self: @ContractState, origin: Origin, receiver: ContractAddress,
        ) -> bool {
            let endpoint_dispatcher = IEndpointV2SafeDispatcher {
                contract_address: self.endpoint.read(),
            };
            endpoint_dispatcher.initializable(origin, receiver).unwrap_or(false)
        }

        /// Checks if the verification is ready to be committed to the endpoint
        fn _check_verifiable(
            self: @ContractState, config: @UlnConfig, header_hash: Bytes32, payload_hash: Bytes32,
        ) -> bool {
            // Check required DVNs
            if config.required_dvns.len() > 0 {
                for dvn in config.required_dvns {
                    if !self._verified(*dvn, header_hash, payload_hash, *config.confirmations) {
                        // return if any of the required DVNs haven't signed
                        return false;
                    }
                }
                if config.optional_dvns.is_empty() {
                    // returns early if all required DVNs have signed and there are no optional DVNs
                    return true;
                }
            }

            // Check optional DVNs threshold
            let mut remaining_threshold = *config.optional_dvn_threshold;
            for dvn in config.optional_dvns {
                if self._verified(*dvn, header_hash, payload_hash, *config.confirmations) {
                    // decrement the threshold if the optional DVN has signed
                    remaining_threshold -= 1;
                    if remaining_threshold == 0 {
                        // early return if the optional threshold has hit
                        return true;
                    }
                }
            }

            // return false as a catch-all
            false
        }

        /// Checks if a specific DVN has verified the payload with sufficient confirmations
        fn _verified(
            self: @ContractState,
            dvn: ContractAddress,
            header_hash: Bytes32,
            payload_hash: Bytes32,
            required_confirmations: u64,
        ) -> bool {
            let verification = self._hash_lookup(header_hash, payload_hash, dvn);
            verification.submitted && verification.confirmations >= required_confirmations
        }

        /// Verifies that all required DVNs have signed and reclaims storage
        fn _verify_and_reclaim_storage(
            ref self: ContractState,
            config: @UlnConfig,
            header_hash: Bytes32,
            payload_hash: Bytes32,
        ) {
            assert_with_byte_array(
                self._check_verifiable(config, header_hash, payload_hash), err_uln_verifying(),
            );

            // iterate the required DVNs and delete their verifications
            if config.required_dvns.len() > 0 {
                for dvn in config.required_dvns {
                    self
                        ._hash_lookup_entry(header_hash, payload_hash, *dvn)
                        .write(EMPTY_VERIFICATION);
                }
            }

            // iterate the optional DVNs and delete their verifications
            if config.optional_dvns.len() > 0 {
                for dvn in config.optional_dvns {
                    self
                        ._hash_lookup_entry(header_hash, payload_hash, *dvn)
                        .write(EMPTY_VERIFICATION);
                }
            }
        }

        // =============================== OApp Config Setters ==================

        fn _set_oapp_executor_config(
            ref self: ContractState, oapp: ContractAddress, dst_eid: u32, config: ExecutorConfig,
        ) {
            self._assert_supported_send_eid(dst_eid);
            self.executor_configs.entry(oapp).entry(dst_eid).write(config.clone());
            self.emit(OAppExecutorConfigSet { oapp, dst_eid, config });
        }

        fn _set_oapp_uln_send_config(
            ref self: ContractState, oapp: ContractAddress, dst_eid: u32, config: UlnConfig,
        ) {
            self._assert_supported_send_eid(dst_eid);

            // Assert no duplicates in DVN arrays before setting
            UlnConfigUtilsImpl::assert_no_duplicate_dvns(@config);

            self.send_configs.entry(oapp).entry(dst_eid).set_uln_config(config.clone());

            // Calling this will make sure the newly set OApp config
            // will end up with us having a valid resolved config,
            // if not, it will revert.
            let _config = self.get_oapp_uln_send_config(oapp, dst_eid);

            self.emit(OAppUlnSendConfigSet { oapp, dst_eid, config });
        }

        fn _set_oapp_uln_receive_config(
            ref self: ContractState, oapp: ContractAddress, src_eid: u32, config: UlnConfig,
        ) {
            self._assert_supported_receive_eid(src_eid);

            // Assert no duplicates in DVN arrays before setting
            UlnConfigUtilsImpl::assert_no_duplicate_dvns(@config);

            self.receive_configs.entry(oapp).entry(src_eid).set_uln_config(config.clone());

            // Calling this will make sure the newly set OApp config
            // will end up with us having a valid resolved config,
            // if not, it will revert.
            let _config = self.get_oapp_uln_receive_config(oapp, src_eid);

            self.emit(OAppUlnReceiveConfigSet { oapp, src_eid, config });
        }

        // Read-only getter for hash_lookup
        fn _hash_lookup(
            self: @ContractState, header_hash: Bytes32, payload_hash: Bytes32, dvn: ContractAddress,
        ) -> Verification {
            self.hash_lookup.entry(header_hash).entry(payload_hash).entry(dvn).read()
        }

        // Mutable setter for hash_lookup
        fn _hash_lookup_entry(
            ref self: ContractState,
            header_hash: Bytes32,
            payload_hash: Bytes32,
            dvn: ContractAddress,
        ) -> StoragePath<Mutable<Verification>> {
            self.hash_lookup.entry(header_hash).entry(payload_hash).entry(dvn)
        }
    }
}
