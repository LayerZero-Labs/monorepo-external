//! Message library structs

#[derive(Copy, Drop, Serde, starknet::Store, PartialEq)]
#[allow(starknet::store_no_default_variant)]
pub enum MessageLibType {
    Send,
    Receive,
    SendAndReceive,
}

/// Parameter for setting configuration on message libraries
#[derive(Drop, Serde)]
pub struct SetConfigParam {
    pub eid: u32,
    pub config_type: u32,
    // this is the encoded config for the message lib
    // this is done to allow changing the config type depending on the message lib used
    pub config: Array<felt252>,
}

#[derive(Drop, Serde)]
pub struct MessageLibVersion {
    pub major: u64,
    pub minor: u8,
    pub endpoint_version: u8,
}
