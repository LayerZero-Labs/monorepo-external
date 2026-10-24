use crate::oapps::common::oapp_options_type_3::structs::EnforcedOptionParam;

#[derive(Drop, starknet::Event)]
pub struct EnforcedOptionSet {
    pub options: Array<EnforcedOptionParam>,
}
