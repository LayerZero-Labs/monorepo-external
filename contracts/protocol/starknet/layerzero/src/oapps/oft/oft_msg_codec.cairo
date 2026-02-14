/// OFTMsgCodec - Cairo implementation of the Solidity OFTMsgCodec library
/// Handles encoding and decoding of OFT messages
pub mod OFTMsgCodec {
    use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
    use lz_utils::bytes::Bytes32;
    use starknet::{ContractAddress, get_caller_address};

    // Offset constants for encoding and decoding OFT messages
    pub const SEND_TO_OFFSET: usize = 32;
    pub const SEND_AMOUNT_SD_OFFSET: usize = 40;

    /// Encodes an OFT LayerZero message.
    ///
    /// # Arguments
    /// * `send_to` - The recipient address as bytes32
    /// * `amount_sd` - The amount in shared decimals (u64)
    /// * `compose_msg` - The composed message
    ///
    /// # Returns
    /// * `(message, has_compose)` - The encoded message and whether it has compose
    pub fn encode(send_to: Bytes32, amount_sd: u64, compose_msg: @ByteArray) -> (ByteArray, bool) {
        let has_compose = compose_msg.len() > 0;
        let mut message: ByteArray = Default::default();

        // Encode send_to (32 bytes)
        message.append_u256(send_to.value);

        // Encode amount_sd (8 bytes)
        message.append_u64(amount_sd);

        if has_compose {
            // For composed messages, include the caller (msg.sender equivalent)
            let caller_bytes32: Bytes32 = get_caller_address().into();
            message.append_u256(caller_bytes32.value);
            message.append(compose_msg);
        }

        (message, has_compose)
    }

    /// Checks if the OFT message is composed.
    ///
    /// # Arguments
    /// * `message` - The OFT message
    ///
    /// # Returns
    /// * `bool` - True if the message is composed
    pub fn is_composed(message: @ByteArray) -> bool {
        message.len() > SEND_AMOUNT_SD_OFFSET
    }

    /// Retrieves the recipient address from the OFT message.
    ///
    /// # Arguments
    /// * `message` - The OFT message
    ///
    /// # Returns
    /// * `Bytes32` - The recipient address
    pub fn send_to(message: @ByteArray) -> Bytes32 {
        let (_, send_to_value) = message.read_u256(0);
        Bytes32 { value: send_to_value }
    }

    /// Retrieves the amount in shared decimals from the OFT message.
    ///
    /// # Arguments
    /// * `message` - The OFT message
    ///
    /// # Returns
    /// * `u64` - The amount in shared decimals
    pub fn amount_sd(message: @ByteArray) -> u64 {
        let (_, amount_value) = message.read_u64(SEND_TO_OFFSET);
        amount_value
    }

    /// Retrieves the composed message from the OFT message.
    ///
    /// # Arguments
    /// * `message` - The OFT message
    ///
    /// # Returns
    /// * `ByteArray` - The composed message
    pub fn compose_msg(message: @ByteArray) -> ByteArray {
        if message.len() > SEND_AMOUNT_SD_OFFSET {
            let compose_length = message.len() - SEND_AMOUNT_SD_OFFSET;
            let (_, compose_value) = message.read_bytes(SEND_AMOUNT_SD_OFFSET, compose_length);
            compose_value
        } else {
            Default::default()
        }
    }

    /// Retrieves the sender address from a composed message.
    /// Only valid for composed messages that include sender information.
    ///
    /// # Arguments
    /// * `message` - The OFT message
    ///
    /// # Returns
    /// * `Option<Bytes32>` - The sender address if available
    pub fn composed_sender(message: @ByteArray) -> Option<Bytes32> {
        if is_composed(message) && message.len() >= SEND_AMOUNT_SD_OFFSET + SEND_TO_OFFSET {
            let (_, sender_value) = message.read_u256(SEND_AMOUNT_SD_OFFSET);
            Option::Some(Bytes32 { value: sender_value })
        } else {
            Option::None
        }
    }

    /// Converts a ContractAddress to Bytes32.
    ///
    /// # Arguments
    /// * `addr` - The address to convert
    ///
    /// # Returns
    /// * `Bytes32` - The bytes32 representation
    pub fn address_to_bytes32(addr: ContractAddress) -> Bytes32 {
        addr.into()
    }

    /// Converts Bytes32 to a ContractAddress.
    ///
    /// # Arguments
    /// * `b` - The bytes32 value to convert
    ///
    /// # Returns
    /// * `Option<ContractAddress>` - The address if valid
    pub fn bytes32_to_address(b: Bytes32) -> Option<ContractAddress> {
        b.try_into()
    }
}
