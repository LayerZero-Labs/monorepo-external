use crate::{
    authority::invoke_as, RoleMember, RoleType, SignerKind, TokenManagerStore,
    TransferHookPolicySet, SIGNER_SEED,
};
use anchor_lang::{prelude::*, solana_program::instruction::Instruction, InstructionData};
use anchor_spl::token_interface::Mint;

/// Bind or re-bind the pubkey-policy hook's policy for this mint, signing as this root's
/// TransferHook signer. That signer must hold the mint's transfer-hook authority, which keeps
/// re-binding (switching screening to another policy, or off by binding an Open one) under RBAC
/// rather than with whichever native key would hold it; `set_native_authority` hands the authority
/// back out. The hook authenticates the signer and checks the policy exists and is this mint's.
#[rbac::only_role(role = RoleType::DefaultAdmin, state = token_manager, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
pub struct SetTransferHookPolicy<'info> {
    pub authority: Signer<'info>,

    /// Pays for the hook manifest when it does not exist yet.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(has_one = mint)]
    pub token_manager: Account<'info, TokenManagerStore>,

    /// CHECK: This root's TransferHook signer PDA; the hook checks it is the mint's transfer-hook
    /// authority.
    #[account(seeds = [SIGNER_SEED, token_manager.key().as_ref(), &[SignerKind::TransferHook as u8]], bump)]
    pub hook_signer: UncheckedAccount<'info>,

    /// The hook checks its owner and reads its transfer-hook authority.
    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: The policy to bind; the hook checks it exists and is this mint's.
    pub pubkey_policy: UncheckedAccount<'info>,

    /// CHECK: The hook's manifest for this mint; the hook pins its address and writes it.
    #[account(mut)]
    pub extra_account_metas: UncheckedAccount<'info>,

    /// CHECK: The hook's event authority; the hook checks it.
    pub hook_event_authority: UncheckedAccount<'info>,

    /// CHECK: The pubkey-policy hook, pinned: the only program this signs into.
    #[account(address = pubkey_policy_hook::ID, executable)]
    pub hook_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl SetTransferHookPolicy<'_> {
    pub fn apply(ctx: &mut Context<Self>) -> Result<()> {
        let a = &ctx.accounts;
        let signer = a.hook_signer.key();
        let accounts = pubkey_policy_hook::accounts::InitTransferHook {
            payer: a.payer.key(),
            authority: signer,
            mint: a.mint.key(),
            pubkey_policy: a.pubkey_policy.key(),
            extra_account_metas: a.extra_account_metas.key(),
            system_program: a.system_program.key(),
            event_authority: a.hook_event_authority.key(),
            program: a.hook_program.key(),
        }
        .to_account_metas(None)
        .into_iter()
        .map(|mut meta| {
            // The hook authenticates its authority in the handler, so the generated metas do not
            // mark it a signer.
            meta.is_signer |= meta.pubkey == signer;
            meta
        })
        .collect();
        let ix = Instruction {
            program_id: pubkey_policy_hook::ID,
            accounts,
            data: pubkey_policy_hook::instruction::InitTransferHook {}.data(),
        };
        invoke_as(
            &a.token_manager.key(),
            &[(SignerKind::TransferHook, ctx.bumps.hook_signer)],
            &ix,
            &[
                a.payer.to_account_info(),
                a.hook_signer.to_account_info(),
                a.mint.to_account_info(),
                a.pubkey_policy.to_account_info(),
                a.extra_account_metas.to_account_info(),
                a.system_program.to_account_info(),
                a.hook_event_authority.to_account_info(),
                a.hook_program.to_account_info(),
            ],
        )?;
        emit_cpi!(TransferHookPolicySet {
            token_manager: a.token_manager.key(),
            pubkey_policy: a.pubkey_policy.key(),
            authority: a.authority.key(),
        });
        Ok(())
    }
}
