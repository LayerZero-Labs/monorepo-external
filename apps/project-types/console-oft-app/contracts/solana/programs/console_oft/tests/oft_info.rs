mod oft;

use ::oft::oft_info::{OftInfo, OFT_INFO_SCHEMA_VERSION};
use console_oft::console_oft_info::{
    ConsoleOftInfo, CONSOLE_OFT_INFO_IDL_VERSION, CONSOLE_OFT_INFO_SCHEMA_VERSION,
};
use oapp::oapp_info::{OAppBase, OAPP_BASE_IDL_VERSION, OAPP_BASE_SCHEMA_VERSION};
use oft::helpers::*;
use spl_discriminator::SplDiscriminate;
use spl_type_length_value::state::{TlvState, TlvStateBorrowed};

/// Off-chain discovery walks OAppBase -> OftInfo -> ConsoleOftInfo by discriminator, so each
/// entry must name the next layer and carry the versions clients branch on.
#[test]
fn oapp_info_chains_the_oapp_oft_and_console_layers() {
    let f = fixture();
    f.ok(&oft_ix(
        console_oft::accounts::InitConsoleOftInfo {
            payer: to_program_pubkey(&f.payer),
            oapp_info: to_program_pubkey(&oapp_info_pda()),
            system_program: Default::default(),
        },
        console_oft::instruction::InitConsoleOftInfo {},
    ));
    let account = f.account(&oapp_info_pda()).unwrap();
    assert_eq!(account.owner, program_id());
    let tlv = TlvStateBorrowed::unpack(&account.data).unwrap();
    let base = tlv.get_first_variable_len_value::<OAppBase>().unwrap();
    let oft = tlv.get_first_variable_len_value::<OftInfo>().unwrap();
    let console = tlv.get_first_variable_len_value::<ConsoleOftInfo>().unwrap();

    assert_eq!(
        (base.schema_version, base.idl_version),
        (OAPP_BASE_SCHEMA_VERSION, OAPP_BASE_IDL_VERSION)
    );
    assert_eq!(base.app_discriminator, <[u8; 8]>::from(OftInfo::SPL_DISCRIMINATOR));
    assert_eq!(oft.schema_version, OFT_INFO_SCHEMA_VERSION);
    assert_eq!(oft.project_discriminator, <[u8; 8]>::from(ConsoleOftInfo::SPL_DISCRIMINATOR));
    assert_eq!(
        (console.schema_version, console.idl_version),
        (CONSOLE_OFT_INFO_SCHEMA_VERSION, CONSOLE_OFT_INFO_IDL_VERSION)
    );
}
