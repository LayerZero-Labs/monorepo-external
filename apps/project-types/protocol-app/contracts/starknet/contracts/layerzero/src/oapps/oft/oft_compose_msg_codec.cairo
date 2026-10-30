/// OFTComposeMsgCodec - Cairo implementation of the Solidity OFTComposeMsgCodec library
/// Handles encoding and decoding of OFT composed messages
pub mod OFTComposeMsgCodec {
    use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
    use lz_utils::bytes::Bytes32;
    use starknet::ContractAddress;

    // Offset constants for encoding and decoding OFT compose messages
    pub const NONCE_OFFSET: usize = 8;
    pub const SRC_EID_OFFSET: usize = 12;
    pub const AMOUNT_LD_OFFSET: usize = 44;
    pub const COMPOSE_FROM_OFFSET: usize = 76;

    /// Encodes an OFT composed message.
    ///
    /// # Arguments
    /// * `nonce` - The nonce value (u64)
    /// * `src_eid` - The source endpoint ID (u32)
    /// * `amount_ld` - The amount in local decimals (u256)
    /// * `compose_msg` - The composed message (composeFrom + composeMsg)
    ///
    /// # Returns
    /// * `ByteArray` - The encoded composed message
    pub fn encode(nonce: u64, src_eid: u32, amount_ld: u256, compose_msg: @ByteArray) -> ByteArray {
        let mut message: ByteArray = Default::default();

        // Encode nonce (8 bytes)
        message.append_u64(nonce);

        // Encode src_eid (4 bytes)
        message.append_u32(src_eid);

        // Encode amount_ld (32 bytes)
        message.append_u256(amount_ld);

        // Append compose message
        message.append(compose_msg);

        message
    }

    /// Retrieves the nonce from the composed message.
    ///
    /// # Arguments
    /// * `message` - The composed message
    ///
    /// # Returns
    /// * `u64` - The nonce value
    pub fn nonce(message: @ByteArray) -> u64 {
        let (_, nonce_value) = message.read_u64(0);
        nonce_value
    }

    /// Retrieves the source endpoint ID from the composed message.
    ///
    /// # Arguments
    /// * `message` - The composed message
    ///
    /// # Returns
    /// * `u32` - The source endpoint ID
    pub fn src_eid(message: @ByteArray) -> u32 {
        let (_, src_eid_value) = message.read_u32(NONCE_OFFSET);
        src_eid_value
    }

    /// Retrieves the amount in local decimals from the composed message.
    ///
    /// # Arguments
    /// * `message` - The composed message
    ///
    /// # Returns
    /// * `u256` - The amount in local decimals
    pub fn amount_ld(message: @ByteArray) -> u256 {
        let (_, amount_value) = message.read_u256(SRC_EID_OFFSET);
        amount_value
    }

    /// Retrieves the composeFrom value from the composed message.
    ///
    /// # Arguments
    /// * `message` - The composed message
    ///
    /// # Returns
    /// * `Bytes32` - The composeFrom value
    pub fn compose_from(message: @ByteArray) -> Bytes32 {
        let (_, compose_from_value) = message.read_u256(AMOUNT_LD_OFFSET);
        Bytes32 { value: compose_from_value }
    }

    /// Retrieves the composed message.
    ///
    /// # Arguments
    /// * `message` - The full composed message
    ///
    /// # Returns
    /// * `ByteArray` - The composed message portion
    pub fn compose_msg(message: @ByteArray) -> ByteArray {
        if message.len() > COMPOSE_FROM_OFFSET {
            let compose_length = message.len() - COMPOSE_FROM_OFFSET;
            let (_, compose_value) = message.read_bytes(COMPOSE_FROM_OFFSET, compose_length);
            compose_value
        } else {
            Default::default()
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
