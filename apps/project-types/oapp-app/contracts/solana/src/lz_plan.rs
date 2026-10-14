//! Output transport for `lz_receive_types_v3` / `lz_compose_types_v3` plans.
//!
//! The caller supplies the output ("scratch") account: it creates it with its own keypair in a
//! top-level `SystemProgram::create_account`, owned by the planner program, ahead of the planner
//! instruction. The program never allocates or resizes the scratch and pays no rent. A top-level
//! create is not a CPI, so `MAX_PERMITTED_DATA_INCREASE` does not apply and the caller alone
//! decides how large the scratch is.
//!
//! The plan is written Borsh-encoded at offset 0, with no header. [`write()`] returns the encoded
//! length whether or not the plan fit, and planners return that as their instruction's return data:
//! a caller whose scratch was too small re-simulates with a larger one, and otherwise reads
//! `data[..length]` from the same simulation's post-state. The scratch's own length says nothing
//! about the plan.
//!
//! Planning is meant to be simulated, not submitted, but nothing here enforces that: a signed
//! transaction can run a planner and leave the scratch account allocated.

use crate::errors::OAppError;
use anchor_lang::prelude::*;

fn validate_output(program: &Pubkey, output: &AccountInfo) -> Result<()> {
    // Checked here so a planner that forgets `mut` fails with this error, not the runtime's.
    require!(output.is_writable, OAppError::InvalidPlanOutput);
    require_keys_eq!(*output.owner, *program, OAppError::InvalidPlanOutput);
    require!(output.try_borrow_data()?.iter().all(|byte| *byte == 0), OAppError::InvalidPlanOutput);
    Ok(())
}

/// Writes `plan` into `output` if it fits, and returns the plan's encoded length either way.
///
/// Fails with `InvalidPlanOutput` unless `output` is writable, owned by `program`, and all of its
/// data is zero. Taking a [`Signer`] means a caller can only hand over an account whose key it
/// holds, and the all-zero check keeps the planner from overwriting initialized program state or an
/// earlier plan.
pub fn write<T: AnchorSerialize>(program: &Pubkey, output: &Signer, plan: &T) -> Result<u32> {
    let output = output.as_ref();
    validate_output(program, output)?;
    let payload = borsh::to_vec(plan)?;
    if payload.len() <= output.data_len() {
        output.try_borrow_mut_data()?[..payload.len()].copy_from_slice(&payload);
    }
    // A plan is bounded by the SBF heap, far below u32::MAX.
    Ok(payload.len() as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_must_be_writable_owned_and_zeroed() {
        let (program, key) = (Pubkey::new_unique(), Pubkey::new_unique());
        let run = |writable: bool, owner: Pubkey, data: Vec<u8>| {
            let (mut lamports, mut data) = (1, data);
            let info =
                AccountInfo::new(&key, true, writable, &mut lamports, &mut data, &owner, false);
            write(&program, &Signer::try_from(&info).unwrap(), &7u32)
        };
        assert_eq!(run(true, program, vec![0; 8]).unwrap(), 4);
        for (writable, owner, data) in [
            (false, program, vec![0; 8]),
            (true, Pubkey::new_unique(), vec![0; 8]),
            (true, program, vec![1; 8]),
        ] {
            assert_eq!(
                run(writable, owner, data).unwrap_err(),
                OAppError::InvalidPlanOutput.into()
            );
        }
    }
}
