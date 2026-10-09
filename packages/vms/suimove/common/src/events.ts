/**
 * Move `vector<u8>` field paths of the LayerZero Sui event structs, keyed by `module::Name` with no
 * package address, since the same event (e.g. `oft::OFTSentEvent`) is emitted by many deployments.
 * Dot-separated paths reach into nested structs, e.g. `sender.bytes`. Must match the `.move` event
 * struct definitions, so update this when an event struct gains or loses a `vector<u8>` field.
 *
 * Kept free of imports so it can be loaded through the `./events` subpath without pulling in the
 * rest of this package.
 */
export const LZ_EVENT_BYTE_VECTOR_FIELDS: Readonly<Record<string, readonly string[]>> = {
    // endpoint_v2::messaging_channel
    'messaging_channel::PacketSentEvent': ['encoded_packet', 'options'],
    'messaging_channel::PacketVerifiedEvent': ['sender.bytes', 'payload_hash.bytes'],
    'messaging_channel::PacketDeliveredEvent': ['sender.bytes'],
    'messaging_channel::InboundNonceSkippedEvent': ['sender.bytes'],
    'messaging_channel::PacketNilifiedEvent': ['sender.bytes', 'payload_hash.bytes'],
    'messaging_channel::PacketBurntEvent': ['sender.bytes', 'payload_hash.bytes'],
    'messaging_channel::LzReceiveAlertEvent': [
        'sender.bytes',
        'guid.bytes',
        'message',
        'extra_data',
    ],
    'messaging_channel::ChannelInitializedEvent': ['remote_oapp.bytes'],
    // endpoint_v2::messaging_composer
    'messaging_composer::ComposeSentEvent': ['guid.bytes', 'message'],
    'messaging_composer::ComposeDeliveredEvent': ['guid.bytes'],
    'messaging_composer::LzComposeAlertEvent': ['guid.bytes', 'message', 'extra_data'],
    'messaging_composer::ComposerRegisteredEvent': ['composer_info'],
    'messaging_composer::ComposerInfoSetEvent': ['composer_info'],
    // endpoint_v2::oapp_registry
    'oapp_registry::OAppRegisteredEvent': ['oapp_info'],
    'oapp_registry::OAppInfoSetEvent': ['oapp_info'],
    // uln_302::send_uln
    'send_uln::ExecutorFeePaidEvent': ['guid.bytes'],
    'send_uln::DVNFeePaidEvent': ['guid.bytes'],
    // uln_302::receive_uln
    'receive_uln::PayloadVerifiedEvent': ['header', 'proof_hash.bytes'],
    // oft::oft
    'oft::OFTSentEvent': ['guid.bytes'],
    'oft::OFTReceivedEvent': ['guid.bytes'],
    // oft_common::oft_composer_manager
    'oft_composer_manager::ComposeTransferSentEvent': ['guid.bytes'],
    // oapp::oapp_peer, oapp::enforced_options
    'oapp_peer::PeerSetEvent': ['peer.bytes'],
    'enforced_options::EnforcedOptionSetEvent': ['options'],
    // worker_common::worker_common
    'worker_common::SetSupportedOptionTypesEvent': ['option_types'],
    // executor::executor_worker
    'executor_worker::NativeDropAppliedEvent': ['sender.bytes'],
    // worker_registry::worker_registry
    'worker_registry::WorkerInfoSetEvent': ['worker_info'],
    // dvn::multisig
    'multisig::UpdateSignerEvent': ['signer'],
};
