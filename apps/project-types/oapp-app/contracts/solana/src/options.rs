use crate::errors::OAppError;
use anchor_lang::prelude::*;

pub const OPTIONS_TYPE_3: u16 = 3;

pub fn combine_options(mut enforced_options: Vec<u8>, extra_options: &[u8]) -> Result<Vec<u8>> {
    // No enforced options, pass whatever the caller supplied, even if it's empty or legacy type
    // 1/2 options.
    if enforced_options.is_empty() {
        return Ok(extra_options.to_vec());
    }

    // No caller options, return enforced
    if extra_options.is_empty() {
        return Ok(enforced_options);
    }

    // If caller provided extra_options, must be type 3 as it's the ONLY type that can be
    // combined.
    if extra_options.len() >= 2 {
        assert_type_3(extra_options)?;
        // Remove the first 2 bytes containing the type from the extra_options and combine with
        // enforced.
        enforced_options.extend_from_slice(&extra_options[2..]);
        return Ok(enforced_options);
    }

    // No valid set of options was found.
    Err(OAppError::InvalidOptions.into())
}

pub fn assert_type_3(options: &[u8]) -> anchor_lang::Result<()> {
    require!(options.len() >= 2, OAppError::InvalidOptionsLength);
    let mut option_type_bytes = [0; 2];
    option_type_bytes.copy_from_slice(&options[0..2]);
    require!(u16::from_be_bytes(option_type_bytes) == OPTIONS_TYPE_3, OAppError::InvalidOptions);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn type3_header() -> [u8; 2] {
        OPTIONS_TYPE_3.to_be_bytes()
    }

    // -----------------------------------------------------------------------
    // assert_type_3
    // -----------------------------------------------------------------------

    #[test]
    fn assert_type_3_valid() {
        assert!(assert_type_3(&type3_header()).is_ok());
    }

    #[test]
    fn assert_type_3_rejects_options_shorter_than_the_type_header() {
        for options in [&[][..], &[0x00][..]] {
            let err = assert_type_3(options).unwrap_err();
            assert_eq!(err, OAppError::InvalidOptionsLength.into());
        }
    }

    #[test]
    fn assert_type_3_wrong_type_returns_invalid_options() {
        let err = assert_type_3(&[0x00, 0x01]).unwrap_err();
        assert_eq!(err, OAppError::InvalidOptions.into());
    }

    // -----------------------------------------------------------------------
    // combine_options — enforced empty
    // -----------------------------------------------------------------------

    #[test]
    fn combine_no_enforced_returns_extra_as_is() {
        let result = combine_options(vec![], &[0x01, 0x02, 0x03]).unwrap();
        assert_eq!(result, vec![0x01, 0x02, 0x03]);
    }

    // -----------------------------------------------------------------------
    // combine_options — extra empty
    // -----------------------------------------------------------------------

    #[test]
    fn combine_enforced_present_extra_empty_returns_enforced() {
        let enforced = vec![0x00, 0x03, 0xFF];
        let result = combine_options(enforced.clone(), &[]).unwrap();
        assert_eq!(result, enforced);
    }

    // -----------------------------------------------------------------------
    // combine_options — both present
    // -----------------------------------------------------------------------

    #[test]
    fn combine_both_present_type3_strips_header_and_appends() {
        let enforced = vec![0x00, 0x03, 0xAA, 0xBB];
        let [h0, h1] = type3_header();
        let extra = vec![h0, h1, 0xCC, 0xDD];

        let result = combine_options(enforced.clone(), &extra).unwrap();

        let mut expected = enforced;
        expected.extend_from_slice(&[0xCC, 0xDD]);
        assert_eq!(result, expected);
    }

    #[test]
    fn combine_both_present_type3_only_header_no_payload() {
        let enforced = vec![0xAA];
        let [h0, h1] = type3_header();
        let extra = vec![h0, h1]; // type-3 header, zero extra payload

        let result = combine_options(enforced.clone(), &extra).unwrap();
        assert_eq!(result, enforced); // nothing appended beyond header
    }

    #[test]
    fn combine_both_present_non_type3_returns_invalid_options() {
        let enforced = vec![0x00, 0x03, 0xAA];
        let extra = vec![0x00, 0x01, 0xBB]; // type 1 — not allowed when enforced exists

        let err = combine_options(enforced, &extra).unwrap_err();
        assert_eq!(err, OAppError::InvalidOptions.into());
    }

    #[test]
    fn combine_both_present_single_byte_extra_returns_invalid_options() {
        // extra_options.len() == 1 → falls through to the final Err
        let enforced = vec![0xAA];
        let extra = vec![0x03]; // only 1 byte

        let err = combine_options(enforced, &extra).unwrap_err();
        assert_eq!(err, OAppError::InvalidOptions.into());
    }
}
