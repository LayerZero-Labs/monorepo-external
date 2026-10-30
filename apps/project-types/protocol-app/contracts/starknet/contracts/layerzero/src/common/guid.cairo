/// GUID generation library
pub mod GUID {
    use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
    use lz_utils::bytes::Bytes32;
    use lz_utils::keccak::keccak256;

    pub fn generate(
        nonce: u64, src_eid: u32, sender: Bytes32, dst_eid: u32, receiver: Bytes32,
    ) -> Bytes32 {
        let mut bytes: ByteArray = Default::default();

        bytes.append_u64(nonce);
        bytes.append_u32(src_eid);
        bytes.append_u256(sender.value);
        bytes.append_u32(dst_eid);
        bytes.append_u256(receiver.value);

        keccak256(@bytes)
    }
}
