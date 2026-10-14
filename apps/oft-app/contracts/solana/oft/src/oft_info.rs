use anchor_lang::prelude::{borsh, AnchorDeserialize, AnchorSerialize, InitSpace};
use anchor_spl::token_interface::spl_token_metadata_interface::solana_borsh;
use spl_discriminator::SplDiscriminate;
use spl_type_length_value::SplBorshVariableLenPack;

pub const OFT_INFO_SCHEMA_VERSION: u8 = 1;

/// TLV entry type for the OFT layer.
///
/// `OftInfo` is the OFT-family record inside the flat OAppInfo TLV container.
/// `OAppBase.app_discriminator` can route to this entry, and this entry owns the
/// `project_discriminator` route field for implementation-specific records such
/// as `ConsoleOftInfo`.
#[derive(
    Clone, AnchorSerialize, AnchorDeserialize, InitSpace, SplDiscriminate, SplBorshVariableLenPack,
)]
#[discriminator_hash_input("oft::info")]
pub struct OftInfo {
    /// Borsh schema version of this entry. Bumps when fields are added,
    /// removed, reordered, or change type. The SDK reads this first to select
    /// the correct parser for the remaining bytes.
    pub schema_version: u8,
    /// SPL discriminator of the implementation-specific TLV entry, if any.
    pub project_discriminator: [u8; 8],
}

impl OftInfo {
    /// Creates an `OftInfo` at the current schema version with the given
    /// project discriminator.
    pub fn new(project_discriminator: [u8; 8]) -> Self {
        Self { schema_version: OFT_INFO_SCHEMA_VERSION, project_discriminator }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::Space;
    use oapp::oapp_info::{TlvSpace, TLV_HEADER_BYTES};
    use spl_type_length_value::{
        state::{TlvState, TlvStateBorrowed, TlvStateMut},
        variable_len_pack::VariableLenPack,
    };

    fn write_entry(entry: OftInfo) -> Vec<u8> {
        let mut buf = vec![0u8; OftInfo::TLV_SPACE];
        let mut state = TlvStateMut::unpack(&mut buf[..]).unwrap();
        let len = entry.get_packed_len().unwrap();
        state.alloc::<OftInfo>(len, false).unwrap();
        state.pack_first_variable_len_value(&entry).unwrap();
        buf
    }

    fn read_entry(buf: &[u8]) -> OftInfo {
        let state = TlvStateBorrowed::unpack(buf).unwrap();
        state.get_first_variable_len_value::<OftInfo>().unwrap()
    }

    const TEST_DISC_A: [u8; 8] = [1, 2, 3, 4, 5, 6, 7, 8];
    const TEST_DISC_B: [u8; 8] = [10, 20, 30, 40, 50, 60, 70, 80];

    #[test]
    fn entry_packed_len_matches_tlv_space() {
        let entry = OftInfo::new(TEST_DISC_A);
        assert_eq!(entry.get_packed_len().unwrap(), OftInfo::INIT_SPACE);
        assert_eq!(entry.get_packed_len().unwrap() + TLV_HEADER_BYTES, OftInfo::TLV_SPACE);
    }

    #[test]
    fn tlv_round_trip_default_versions() {
        let entry = OftInfo::new(TEST_DISC_A);
        let buf = write_entry(entry);
        let out = read_entry(&buf);

        assert_eq!(out.schema_version, OFT_INFO_SCHEMA_VERSION);
        assert_eq!(out.project_discriminator, TEST_DISC_A);
    }

    #[test]
    fn tlv_round_trip_different_discriminators() {
        let entry_a = OftInfo::new(TEST_DISC_A);
        let entry_b = OftInfo::new(TEST_DISC_B);

        let buf_a = write_entry(entry_a);
        let buf_b = write_entry(entry_b);
        let out_a = read_entry(&buf_a);
        let out_b = read_entry(&buf_b);

        assert_eq!(out_a.project_discriminator, TEST_DISC_A);
        assert_eq!(out_b.project_discriminator, TEST_DISC_B);
        assert_ne!(out_a.project_discriminator, out_b.project_discriminator);
    }
}
