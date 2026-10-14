//! Thin test entrypoint into the unmodified, pinned upstream processor. Mollusk's
//! bundled Token-2022 predates PermissionedBurn; it cannot prove PB behavior.
use solana_account_info::AccountInfo;
use solana_address::Address;
use solana_program_error::ProgramResult;

solana_program_entrypoint::entrypoint!(process_instruction);
fn process_instruction(program: &Address, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    spl_token_2022::processor::Processor::process(program, accounts, data)
}
