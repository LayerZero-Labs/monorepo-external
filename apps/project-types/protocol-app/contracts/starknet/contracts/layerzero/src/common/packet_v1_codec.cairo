/// Cairo implementation of the Solidity PacketV1Codec library
///
/// Handles encoding and decoding of LayerZero packets
pub mod PacketV1Codec {
    use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
    use lz_utils::bytes::{Bytes32, ContractAddressIntoBytes32};
    use lz_utils::error::{Error, assert_with_byte_array, format_error};
    use lz_utils::keccak::keccak256;
    use starknet::ContractAddress;
    use crate::common::structs::packet::Packet;

    // Constants
    pub const PACKET_VERSION: u8 = 1;
    pub const PACKET_HEADER_LENGTH: u32 = 81;

    // Offsets for packet structure
    // header (version + nonce + path)
    pub const PACKET_VERSION_OFFSET: usize = 0;
    pub const NONCE_OFFSET: usize = 1;
    pub const SRC_EID_OFFSET: usize = 9;
    pub const SENDER_OFFSET: usize = 13;
    pub const DST_EID_OFFSET: usize = 45;
    pub const RECEIVER_OFFSET: usize = 49;
    // payload (guid + message)
    pub const GUID_OFFSET: usize = 81;
    pub const MESSAGE_OFFSET: usize = 113;

    /// Struct for decoding the packet payload
    pub struct PacketPayload {
        pub guid: Bytes32,
        pub message: ByteArray,
    }

    /// Same as [`Packet`] but with `Bytes32` sender
    pub struct PacketSenderBytes {
        pub nonce: u64,
        pub src_eid: u32,
        pub sender: Bytes32,
        pub dst_eid: u32,
        pub receiver: Bytes32,
        pub guid: Bytes32,
        pub message: ByteArray,
    }

    #[derive(Drop)]
    pub enum PacketV1CodecError {
        InvalidSenderAddress,
        InvalidReceiverAddress,
        InvalidPacketVersion,
        InvalidPacketHeader,
        InvalidEid,
    }

    impl ErrorNameImpl of Error<PacketV1CodecError> {
        fn prefix() -> ByteArray {
            "LZ_PACKET_V1_CODEC"
        }

        fn name(self: PacketV1CodecError) -> ByteArray {
            match self {
                PacketV1CodecError::InvalidSenderAddress => "INVALID_SENDER_ADDRESS",
                PacketV1CodecError::InvalidReceiverAddress => "INVALID_RECEIVER_ADDRESS",
                PacketV1CodecError::InvalidPacketVersion => "INVALID_PACKET_VERSION",
                PacketV1CodecError::InvalidPacketHeader => "INVALID_PACKET_HEADER",
                PacketV1CodecError::InvalidEid => "INVALID_EID",
            }
        }
    }

    pub fn err_invalid_sender_address(sender: Bytes32) -> ByteArray {
        format_error(PacketV1CodecError::InvalidSenderAddress, format!("sender: {}", sender.value))
    }

    pub fn err_invalid_receiver_address(receiver: Bytes32) -> ByteArray {
        format_error(
            PacketV1CodecError::InvalidReceiverAddress, format!("receiver: {}", receiver.value),
        )
    }

    pub fn err_invalid_packet_version(version: u8) -> ByteArray {
        format_error(PacketV1CodecError::InvalidPacketVersion, format!("version: {}", version))
    }

    pub fn err_invalid_packet_header(expected_length: u32, actual_length: u32) -> ByteArray {
        format_error(
            PacketV1CodecError::InvalidPacketHeader,
            format!("expected_length: {}, actual_length: {}", expected_length, actual_length),
        )
    }

    pub fn err_invalid_eid(expected_eid: u32, actual_eid: u32) -> ByteArray {
        format_error(
            PacketV1CodecError::InvalidEid,
            format!("expected_eid: {}, actual_eid: {}", expected_eid, actual_eid),
        )
    }

    /// Encodes only the packet header (version + nonce + path) into a byte array
    pub fn encode_header(packet: @Packet) -> ByteArray {
        let sender_bytes32: Bytes32 = (*packet.sender).into();

        // Packet header encoding format:
        // 1 byte version
        // 8 bytes nonce
        // 4 bytes srcEid
        // 32 bytes sender
        // 4 bytes dstEid
        // 32 bytes receiver
        let mut header: ByteArray = Default::default();

        header.append_u8(PACKET_VERSION);
        header.append_u64(*packet.nonce);
        header.append_u32(*packet.src_eid);
        header.append_u256(sender_bytes32.value);
        header.append_u32(*packet.dst_eid);
        header.append_u256(*packet.receiver.value);

        header
    }

    /// Encodes the packet payload (guid + message) into a byte array
    pub fn encode_payload(packet: @Packet) -> ByteArray {
        let mut payload: ByteArray = Default::default();

        payload.append_u256(*packet.guid.value);
        payload.append(packet.message);

        payload
    }

    /// Encodes a packet struct into a byte array following the LayerZero packet format
    pub fn encode(packet: @Packet) -> ByteArray {
        // Packet encoding:
        // PacketHeader + bytes32 guid + byteArray message
        let mut encoded_header: ByteArray = encode_header(packet);
        let mut encoded_payload: ByteArray = encode_payload(packet);
        encoded_header.append(@encoded_payload);
        encoded_header
    }

    /// Extracts the header from an encoded packet
    pub fn header(packet: @ByteArray) -> ByteArray {
        let (_, header_value) = packet.read_bytes(0, GUID_OFFSET);
        header_value
    }

    /// Extracts the version from an encoded packet
    pub fn version(packet: @ByteArray) -> u8 {
        let (_, version_value) = packet.read_u8(PACKET_VERSION_OFFSET);
        version_value
    }

    /// Extracts the nonce from an encoded packet
    pub fn nonce(packet: @ByteArray) -> u64 {
        let (_, nonce_value) = packet.read_u64(NONCE_OFFSET);
        nonce_value
    }

    /// Extracts the source EID from an encoded packet
    pub fn src_eid(packet: @ByteArray) -> u32 {
        let (_, src_eid_value) = packet.read_u32(SRC_EID_OFFSET);
        src_eid_value
    }

    /// Extracts the sender as Bytes32 from an encoded packet
    pub fn sender(packet: @ByteArray) -> Bytes32 {
        let (_, sender_value) = packet.read_u256(SENDER_OFFSET);
        Bytes32 { value: sender_value }
    }

    /// Extracts the sender as ContractAddress from an encoded packet
    pub fn sender_address(packet: @ByteArray) -> ContractAddress {
        let sender_bytes32 = sender(packet);
        let sender_address = sender_bytes32.try_into();
        assert_with_byte_array(
            sender_address.is_some(), err_invalid_sender_address(sender_bytes32),
        );

        sender_address.unwrap()
    }

    /// Extracts the destination EID from an encoded packet
    pub fn dst_eid(packet: @ByteArray) -> u32 {
        let (_, dst_eid_value) = packet.read_u32(DST_EID_OFFSET);
        dst_eid_value
    }

    /// Extracts the receiver from an encoded packet
    pub fn receiver(packet: @ByteArray) -> Bytes32 {
        let (_, receiver_value) = packet.read_u256(RECEIVER_OFFSET);
        Bytes32 { value: receiver_value }
    }

    /// Extracts the receiver as ContractAddress from an encoded packet
    pub fn receiver_address(packet: @ByteArray) -> ContractAddress {
        let receiver_bytes32 = receiver(packet);
        let receiver_address = receiver_bytes32.try_into();
        assert_with_byte_array(
            receiver_address.is_some(), err_invalid_receiver_address(receiver_bytes32),
        );

        receiver_address.unwrap()
    }

    /// Extracts the GUID from an encoded packet
    pub fn guid(packet: @ByteArray) -> Bytes32 {
        let (_, guid_value) = packet.read_u256(GUID_OFFSET);
        Bytes32 { value: guid_value }
    }

    /// Extracts the message from an encoded packet
    /// * `ByteArray` - The message
    pub fn message(packet: @ByteArray) -> ByteArray {
        let message_length = packet.len() - MESSAGE_OFFSET;
        let (_, message_value) = packet.read_bytes(MESSAGE_OFFSET, message_length);
        message_value
    }

    /// Extracts the payload (guid + message) from an encoded packet
    pub fn payload(packet: @ByteArray) -> ByteArray {
        let payload_length = packet.len() - GUID_OFFSET;
        let (_, payload_value) = packet.read_bytes(GUID_OFFSET, payload_length);
        payload_value
    }

    /// Computes the keccak256 hash of the payload
    pub fn payload_hash(packet: @ByteArray) -> Bytes32 {
        let payload_bytes = payload(packet);
        keccak256(@payload_bytes)
    }

    /// Decodes only the packet payload from a byte array into individual components
    /// Returns: (guid, message)
    pub fn decode_payload(encoded_packet: @ByteArray) -> PacketPayload {
        PacketPayload { guid: guid(encoded_packet), message: message(encoded_packet) }
    }

    /// Decodes a complete encoded packet into a Packet struct
    /// Note: This assumes the sender can be converted to ContractAddress
    /// If conversion fails, it will panic - use decode_with_bytes32_sender for safer decoding
    pub fn decode(encoded_packet: @ByteArray) -> Packet {
        get_and_assert_version(encoded_packet);

        let PacketSenderBytes {
            nonce, src_eid, sender: sender_bytes32, dst_eid, receiver, guid, message,
        } = decode_with_bytes32_sender(encoded_packet);

        Packet {
            nonce,
            src_eid,
            dst_eid,
            receiver,
            guid,
            message,
            sender: sender_bytes32.try_into().expect('Invalid sender address'),
        }
    }

    /// Decodes a complete encoded packet into a Packet struct with Bytes32 sender
    /// This is safer than decode() as it doesn't attempt address conversion
    pub fn decode_with_bytes32_sender(encoded_packet: @ByteArray) -> PacketSenderBytes {
        get_and_assert_version(encoded_packet);

        PacketSenderBytes {
            nonce: nonce(encoded_packet),
            src_eid: src_eid(encoded_packet),
            sender: sender(encoded_packet),
            dst_eid: dst_eid(encoded_packet),
            receiver: receiver(encoded_packet),
            guid: guid(encoded_packet),
            message: message(encoded_packet),
        }
    }

    pub fn get_and_assert_version(packet_header: @ByteArray) -> u8 {
        let header_version = version(packet_header);
        assert_with_byte_array(
            header_version == PACKET_VERSION, err_invalid_packet_version(header_version),
        );

        header_version
    }

    /// Asserts that a packet header is valid for the given local endpoint ID
    /// Validates:
    /// - Header length is exactly 81 bytes
    /// - Packet version matches PACKET_VERSION
    /// - Destination EID matches the local endpoint ID
    pub fn assert_header(packet_header: @ByteArray, local_eid: u32) {
        // Assert packet header is of right size (81 bytes)
        let header_length = packet_header.len();
        assert_with_byte_array(
            header_length == PACKET_HEADER_LENGTH,
            err_invalid_packet_header(PACKET_HEADER_LENGTH, header_length),
        );

        // Assert packet header version is the same as ULN
        get_and_assert_version(packet_header);

        // Assert the packet is for this endpoint
        let packet_dst_eid = dst_eid(packet_header);
        assert_with_byte_array(
            packet_dst_eid == local_eid, err_invalid_eid(local_eid, packet_dst_eid),
        );
    }
}
