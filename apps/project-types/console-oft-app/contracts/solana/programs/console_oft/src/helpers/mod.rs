use anchor_lang::prelude::*;
use num_enum::IntoPrimitive;

use crate::EnforcedOptions;

pub mod credit_redirect;
pub mod pubkey_policy;
pub mod receive_accounts;
pub mod token2022;
pub mod transfer_hook_accounts;
pub mod transfer_hook_plan;

pub use credit_redirect::*;
pub use pubkey_policy::*;
pub use receive_accounts::*;
pub use token2022::*;
pub use transfer_hook_accounts::*;
pub use transfer_hook_plan::*;

#[repr(u16)]
#[derive(Clone, Copy, PartialEq, Eq, IntoPrimitive)]
pub enum MsgType {
    Send = 1,
    SendAndCall = 2,
}

pub fn msg_type(compose_msg: Option<&[u8]>) -> MsgType {
    if compose_msg.is_some() {
        MsgType::SendAndCall
    } else {
        MsgType::Send
    }
}

pub fn combine_options(
    enforced_options: Option<&EnforcedOptions>,
    extra_options: &[u8],
) -> Result<Vec<u8>> {
    let options = enforced_options.map(|o| o.options.clone()).unwrap_or_default();
    oapp::options::combine_options(options, extra_options)
}

pub fn serialize_into_owned_unchecked_account<T: AccountSerialize + Owner>(
    account: &UncheckedAccount,
    value: Option<&T>,
) -> Result<()> {
    let Some(value) = value else {
        return Ok(());
    };

    let account_info = account.to_account_info();

    require!(
        T::owner() == crate::ID && account_info.owner == &crate::ID,
        anchor_lang::error::ErrorCode::AccountOwnedByWrongProgram
    );

    require!(account_info.is_writable, anchor_lang::error::ErrorCode::AccountNotMutable);

    let mut data = account_info.try_borrow_mut_data()?;
    value.try_serialize(&mut &mut data[..])?;

    Ok(())
}
