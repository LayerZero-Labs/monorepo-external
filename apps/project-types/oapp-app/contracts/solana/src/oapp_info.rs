use anchor_lang::{
    prelude::{borsh, AccountInfo, AnchorDeserialize, AnchorSerialize, InitSpace},
    Space,
};
use anchor_spl::token_interface::spl_token_metadata_interface::solana_borsh;
use spl_discriminator::SplDiscriminate;
use spl_type_length_value::{
    state::TlvStateMut, variable_len_pack::VariableLenPack, SplBorshVariableLenPack,
};

use crate::errors::OAppError;

/// TLV entry header size in bytes: 8-byte type discriminator + 4-byte u32 length.
pub const TLV_HEADER_BYTES: usize = 12;

/// Total on-wire size of a TLV entry: header overhead plus the Borsh-serialized
/// value bytes reported by `Space::INIT_SPACE` (auto-derived via `InitSpace`).
///
/// Blanket-implemented for every `Space + SplDiscriminate` type, so any struct
/// that derives `InitSpace` and `SplDiscriminate` gets `TLV_SPACE` for free —
/// use it when sizing the containing Anchor account.
pub trait TlvSpace {
    const TLV_SPACE: usize;
}

impl<T: Space + SplDiscriminate> TlvSpace for T {
    const TLV_SPACE: usize = TLV_HEADER_BYTES + <T as Space>::INIT_SPACE;
}

/// Borsh schema version of `OAppBase`. See `docs/oapp-info.md` § `schema_version` Bump Rules.
pub const OAPP_BASE_SCHEMA_VERSION: u8 = 1;

/// IDL version (instructions + events) for this build. See `docs/oapp-info.md` § `idl_version`
/// Bump Rules.
pub const OAPP_BASE_IDL_VERSION: IdlVersion = IdlVersion { major: 2, minor: 0 };

/// Sentinel: no app-layer TLV entry follows `OAppBase`.
pub const NO_APP_DISCRIMINATOR: [u8; 8] = [0u8; 8];

#[derive(Clone, Copy, AnchorSerialize, AnchorDeserialize, InitSpace, PartialEq, Eq, Debug)]
pub struct IdlVersion {
    pub major: u8,
    pub minor: u8,
}

/// TLV entry type for the OApp framework layer. Written via `init_oapp_base!`.
#[derive(
    Clone, AnchorSerialize, AnchorDeserialize, InitSpace, SplDiscriminate, SplBorshVariableLenPack,
)]
#[discriminator_hash_input("oapp::base")]
pub struct OAppBase {
    /// Borsh schema version of this entry. Bumps when fields are added, removed, reordered, or
    /// change type. The SDK reads this first to select the correct parser for the remaining bytes.
    pub schema_version: u8,

    /// IDL version (instructions + events). Bumps independently of `schema_version`.
    pub idl_version: IdlVersion,

    /// Discriminator of the sibling app-layer TLV entry — the SDK reads this to find the app
    /// entry. Set to the entry type's `SplDiscriminate::SPL_DISCRIMINATOR`
    /// (e.g., `OftInfo::SPL_DISCRIMINATOR`), or `NO_APP_DISCRIMINATOR` when no app entry is
    /// present.
    pub app_discriminator: [u8; 8],
}

/// Allocates and writes a new TLV entry into an OAppInfo account's data buffer.
/// Call this once per entry type during account initialization. Fails if the
/// type already exists.
///
/// **Precondition:** the account must be freshly allocated and zero-filled in
/// the same instruction — typically via Anchor `#[account(init, ...)]`. Calling
/// on a reused or partially-written account can leave undetected residual TLV
/// entries beyond the ones written here, since the underlying TLV parser stops
/// at the first all-zero discriminator and does not scan trailing bytes.
pub fn init_tlv_entry<T: SplDiscriminate + VariableLenPack>(
    info: &AccountInfo,
    entry: &T,
) -> anchor_lang::Result<()> {
    let mut raw = info.try_borrow_mut_data()?;
    let mut state = TlvStateMut::unpack(&mut raw[..])?;
    state.alloc_and_pack_variable_len_entry(entry, false)?;
    Ok(())
}

/// Overwrites an existing TLV entry in-place. Returns `TlvLengthMismatch` if
/// the new value's packed length differs from the existing entry's.
pub fn update_tlv_entry<T: SplDiscriminate + VariableLenPack>(
    info: &AccountInfo,
    entry: &T,
) -> anchor_lang::Result<()> {
    let new_len = entry.get_packed_len()?;
    let mut raw = info.try_borrow_mut_data()?;
    let mut state = TlvStateMut::unpack(&mut raw[..])?;

    let slot = state.get_first_bytes_mut::<T>()?;
    anchor_lang::require!(new_len == slot.len(), OAppError::TlvLengthMismatch);
    entry.pack(slot)?;
    Ok(())
}

/// Initializes an OAppInfo account by writing the framework `OAppBase` TLV
/// entry.
///
/// Anchor manages account lifecycle (init, seeds, bump); TLV occupies the full
/// account data from byte 0 (no Anchor discriminator).
///
/// ```ignore
/// // Framework entry only — generic OApp, no app-layer sibling.
/// oapp::init_oapp_base!(&oapp_info);
///
/// // Framework entry pointing to an app-layer TLV entry type.
/// oapp::init_oapp_base!(&oapp_info, MyAppInfo);
/// oapp::oapp_info::init_tlv_entry(&oapp_info, &my_app_info)?;
/// ```
///
/// Passing an app-layer type sets `OAppBase.app_discriminator` only; it does not write that
/// app-layer TLV entry. The program's own initialization helper must call `init_tlv_entry` for
/// the referenced entry in the same initialize path, so `OAppBase` does not advertise a missing
/// sibling entry.
#[macro_export]
macro_rules! init_oapp_base {
    // init_oapp_base!(&oapp_info)
    ($oapp_info:expr $(,)?) => {{
        $crate::init_oapp_base!(@inner $oapp_info, $crate::oapp_info::NO_APP_DISCRIMINATOR)
    }};

    // init_oapp_base!(&oapp_info, AppType)
    ($oapp_info:expr, $app_type:ty $(,)?) => {{
        $crate::init_oapp_base!(
            @inner $oapp_info,
            <[u8; 8]>::from(<$app_type as ::spl_discriminator::SplDiscriminate>::SPL_DISCRIMINATOR)
        )
    }};

    // Single implementation — not part of the public API.
    (@inner $oapp_info:expr, $disc:expr) => {{
        let _entry = $crate::oapp_info::OAppBase {
            schema_version: $crate::oapp_info::OAPP_BASE_SCHEMA_VERSION,
            idl_version: $crate::oapp_info::OAPP_BASE_IDL_VERSION,
            app_discriminator: $disc,
        };
        $crate::oapp_info::init_tlv_entry($oapp_info, &_entry)?;
    }};
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::Pubkey;
    use spl_type_length_value::state::{TlvState, TlvStateBorrowed, TlvStateMut};

    fn write_entry(entry: OAppBase) -> Vec<u8> {
        let mut buf = vec![0u8; OAppBase::TLV_SPACE];
        let mut state = TlvStateMut::unpack(&mut buf[..]).unwrap();
        let len = entry.get_packed_len().unwrap();
        state.alloc::<OAppBase>(len, false).unwrap();
        state.pack_first_variable_len_value(&entry).unwrap();
        buf
    }

    fn read_entry(buf: &[u8]) -> OAppBase {
        let state = TlvStateBorrowed::unpack(buf).unwrap();
        state.get_first_variable_len_value::<OAppBase>().unwrap()
    }

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
    #[discriminator_hash_input("oapp::tests::variable-info")]
    struct VariableInfo {
        #[max_len(16)]
        bytes: Vec<u8>,
    }

    impl VariableInfo {
        fn new(bytes: &[u8]) -> Self {
            Self { bytes: bytes.to_vec() }
        }
    }

    fn test_account_info<'a>(
        key: &'a Pubkey,
        owner: &'a Pubkey,
        lamports: &'a mut u64,
        data: &'a mut [u8],
    ) -> AccountInfo<'a> {
        AccountInfo::new(key, false, true, lamports, data, owner, false)
    }

    fn read_variable_info(info: &AccountInfo) -> VariableInfo {
        let raw = info.try_borrow_data().unwrap();
        let state = TlvStateBorrowed::unpack(&raw[..]).unwrap();
        state.get_first_variable_len_value::<VariableInfo>().unwrap()
    }

    #[test]
    fn entry_packed_len_matches_tlv_space() {
        let entry = OAppBase {
            schema_version: OAPP_BASE_SCHEMA_VERSION,
            idl_version: OAPP_BASE_IDL_VERSION,
            app_discriminator: NO_APP_DISCRIMINATOR,
        };
        // get_packed_len and INIT_SPACE both report value bytes only; TLV_SPACE adds framing.
        assert_eq!(entry.get_packed_len().unwrap(), OAppBase::INIT_SPACE);
        assert_eq!(entry.get_packed_len().unwrap() + TLV_HEADER_BYTES, OAppBase::TLV_SPACE);
    }

    #[test]
    fn tlv_round_trip_default_versions() {
        let entry = OAppBase {
            schema_version: OAPP_BASE_SCHEMA_VERSION,
            idl_version: OAPP_BASE_IDL_VERSION,
            app_discriminator: NO_APP_DISCRIMINATOR,
        };
        let buf = write_entry(entry);
        let out = read_entry(&buf);

        assert_eq!(out.schema_version, OAPP_BASE_SCHEMA_VERSION);
        assert_eq!(out.idl_version, OAPP_BASE_IDL_VERSION);
        assert_eq!(out.app_discriminator, NO_APP_DISCRIMINATOR);
    }

    #[test]
    fn tlv_round_trip_with_app_discriminator() {
        let disc = [1, 2, 3, 4, 5, 6, 7, 8];
        let entry = OAppBase {
            schema_version: OAPP_BASE_SCHEMA_VERSION,
            idl_version: OAPP_BASE_IDL_VERSION,
            app_discriminator: disc,
        };
        let buf = write_entry(entry);
        let out = read_entry(&buf);

        assert_eq!(out.app_discriminator, disc);
        assert_eq!(out.schema_version, OAPP_BASE_SCHEMA_VERSION);
        assert_eq!(out.idl_version, OAPP_BASE_IDL_VERSION);
    }

    #[test]
    fn update_tlv_entry_rejects_longer_value() {
        let key = Pubkey::new_unique();
        let owner = Pubkey::new_unique();
        let mut lamports = 1;
        let mut data = vec![0u8; VariableInfo::TLV_SPACE];
        let info = test_account_info(&key, &owner, &mut lamports, &mut data);

        let original = VariableInfo::new(&[1, 2, 3]);
        init_tlv_entry(&info, &original).unwrap();

        let err = update_tlv_entry(&info, &VariableInfo::new(&[1, 2, 3, 4])).unwrap_err();
        assert_eq!(err, OAppError::TlvLengthMismatch.into());
        assert_eq!(read_variable_info(&info), original);
    }

    #[test]
    fn update_tlv_entry_rejects_shorter_value() {
        let key = Pubkey::new_unique();
        let owner = Pubkey::new_unique();
        let mut lamports = 1;
        let mut data = vec![0u8; VariableInfo::TLV_SPACE];
        let info = test_account_info(&key, &owner, &mut lamports, &mut data);

        let original = VariableInfo::new(&[1, 2, 3, 4]);
        init_tlv_entry(&info, &original).unwrap();

        let err = update_tlv_entry(&info, &VariableInfo::new(&[1, 2, 3])).unwrap_err();
        assert_eq!(err, OAppError::TlvLengthMismatch.into());
        assert_eq!(read_variable_info(&info), original);
    }
}
