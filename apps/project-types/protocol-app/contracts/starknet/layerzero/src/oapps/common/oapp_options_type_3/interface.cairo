use crate::oapps::common::oapp_options_type_3::structs::EnforcedOptionParam;

#[starknet::interface]
pub trait IOAppOptionsType3<TContractState> {
    /// Sets the enforced options for specific endpoint and message type combinations.
    /// Only the owner/admin of the OApp can call this function.
    ///
    /// # Arguments
    /// * `enforced_options` - Array of EnforcedOptionParam structures specifying enforced options
    fn set_enforced_options(ref self: TContractState, enforced_options: Array<EnforcedOptionParam>);

    /// Combines options for a given endpoint and message type.
    ///
    /// # Arguments
    /// * `eid` - The endpoint ID
    /// * `msg_type` - The OApp message type
    /// * `extra_options` - Additional options passed by the caller
    ///
    /// # Returns
    /// * `ByteArray` - The combination of caller specified options AND enforced options
    fn combine_options(
        self: @TContractState, eid: u32, msg_type: u16, extra_options: ByteArray,
    ) -> ByteArray;

    /// Gets the enforced options for a specific endpoint and message type
    ///
    /// # Arguments
    /// * `eid` - The endpoint ID
    /// * `msg_type` - The OApp message type
    ///
    /// # Returns
    /// * `ByteArray` - The enforced options
    fn get_enforced_options(self: @TContractState, eid: u32, msg_type: u16) -> ByteArray;
}
