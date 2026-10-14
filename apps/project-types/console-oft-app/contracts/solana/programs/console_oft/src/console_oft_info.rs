use anchor_lang::prelude::{borsh, AccountInfo, AnchorDeserialize, AnchorSerialize, InitSpace};
use anchor_spl::token_interface::spl_token_metadata_interface::solana_borsh;
use oapp::oapp_info::IdlVersion;
use oft::oft_info::OftInfo;
use spl_discriminator::SplDiscriminate;
use spl_type_length_value::SplBorshVariableLenPack;

pub const CONSOLE_OFT_INFO_SCHEMA_VERSION: u8 = 1;
pub const CONSOLE_OFT_INFO_IDL_VERSION: IdlVersion = IdlVersion { major: 2, minor: 0 };

/// TLV entry type for the Console OFT layer.
///
/// Written into the OAppInfo account as a sibling to `OAppBase` and `OftInfo`.
/// This is the concrete project leaf for the standard Console OFT route graph.
#[derive(
    Clone,
    Debug,
    PartialEq,
    Eq,
    AnchorSerialize,
    AnchorDeserialize,
    InitSpace,
    SplDiscriminate,
    SplBorshVariableLenPack,
)]
#[discriminator_hash_input("console-oft::info")]
pub struct ConsoleOftInfo {
    pub schema_version: u8,
    pub idl_version: IdlVersion,
}

impl Default for ConsoleOftInfo {
    fn default() -> Self {
        Self {
            schema_version: CONSOLE_OFT_INFO_SCHEMA_VERSION,
            idl_version: CONSOLE_OFT_INFO_IDL_VERSION,
        }
    }
}

/// Writes the OAppBase / OftInfo / ConsoleOftInfo TLV chain into a freshly
/// initialized OAppInfo account.
pub fn init_console_oft_info(info: &AccountInfo) -> anchor_lang::Result<()> {
    let oft_info = OftInfo::new(ConsoleOftInfo::SPL_DISCRIMINATOR.into());
    oapp::init_oapp_base!(info, OftInfo);
    oapp::oapp_info::init_tlv_entry(info, &oft_info)?;
    oapp::oapp_info::init_tlv_entry(info, &ConsoleOftInfo::default())
}
