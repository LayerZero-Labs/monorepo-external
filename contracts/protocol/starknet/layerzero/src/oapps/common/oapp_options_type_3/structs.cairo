#[derive(Drop, Serde, Clone)]
pub struct EnforcedOptionParam {
    pub eid: u32,
    pub msg_type: u16,
    pub options: ByteArray,
}
