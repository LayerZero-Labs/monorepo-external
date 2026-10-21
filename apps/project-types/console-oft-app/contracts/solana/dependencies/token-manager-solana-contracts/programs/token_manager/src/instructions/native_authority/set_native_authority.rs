use crate::{
    authority::{invoke_as, invoke_as_authority},
    errors::TokenManagerError,
    NativeAuthorityChanged, RoleMember, RoleType, SignerKind, TokenManagerStore, SIGNER_SEED,
};
use anchor_lang::prelude::*;
use anchor_spl::{token_2022::Token2022, token_interface::Mint};
use spl_token_2022_interface::instruction::AuthorityType;
use token_acl_interface::TOKEN_ACL_ID;
use token_manager_interface::{acl, signer_address};

/// Move a signer's native authority to `new_authority`. Null is permanent in Token-2022, so it is
/// rejected: the TokenManager never renounces. To renounce, hand the authority to a key that then
/// nulls it natively. To pause a capability, revoke its roles instead.
///
/// The signer may hold the authority directly or as one member of a 1-of-n native multisig passed
/// as `multisig`; without this, a multisig whose members are all program PDAs could never move.
#[rbac::only_role(role = RoleType::DefaultAdmin, state = token_manager, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
#[instruction(kind: SignerKind)]
pub struct SetNativeAuthority<'info> {
    pub authority: Signer<'info>,

    #[account(has_one = mint)]
    pub token_manager: Account<'info, TokenManagerStore>,

    /// CHECK: This state's signer PDA for `kind`, the current native authority or one member of
    /// it.
    #[account(seeds = [SIGNER_SEED, token_manager.key().as_ref(), &[kind as u8]], bump)]
    pub signer: UncheckedAccount<'info>,

    /// CHECK: The native authority when it is a 1-of-n native multisig with `signer` as a member;
    /// omit when `signer` is the authority itself. Token-2022 checks it is the mint's authority of
    /// this kind and that `signer` alone meets its threshold. Not accepted for `SignerKind::Acl`.
    pub multisig: Option<UncheckedAccount<'info>>,

    #[account(mut, owner = spl_token_2022_interface::ID)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: This mint's MintConfig, required for `SignerKind::Acl`. Pinned by address because
    /// Token ACL's SetAuthority does not check the mint; Token ACL checks the signer is its admin.
    #[account(mut, address = acl::mint_config_address(&mint.key()))]
    pub mint_config: Option<UncheckedAccount<'info>>,

    /// CHECK: Pinned Token ACL; required for `SignerKind::Acl`.
    #[account(address = TOKEN_ACL_ID, executable)]
    pub acl_program: Option<UncheckedAccount<'info>>,

    pub token_program: Program<'info, Token2022>,
}

impl SetNativeAuthority<'_> {
    pub fn apply(ctx: &mut Context<Self>, kind: SignerKind, new_authority: Pubkey) -> Result<()> {
        let a = &ctx.accounts;
        let state = a.token_manager.key();
        // Permanent dead ends: null, the root (it never signs), the ACL config itself, and this
        // root's signers — this instruction only ever signs as `kind`'s own PDA, so an authority
        // parked on another kind's PDA (or back on this one) could never move again.
        let dead_ends = [Pubkey::default(), state, acl::mint_config_address(&a.mint.key())]
            .into_iter()
            .chain(SignerKind::ALL.map(|other| signer_address(&state, other).0));
        for dead_end in dead_ends {
            require_keys_neq!(new_authority, dead_end, TokenManagerError::InvalidNewAuthority);
        }

        match kind {
            SignerKind::Acl => {
                require!(a.multisig.is_none(), TokenManagerError::AclMultisigUnsupported);
                let (Some(config), Some(program)) = (&a.mint_config, &a.acl_program) else {
                    return err!(TokenManagerError::MissingAclAccounts);
                };
                let ix = token_acl_client::instructions::SetAuthorityBuilder::new()
                    .authority(a.signer.key())
                    .mint_config(config.key())
                    .new_authority(new_authority)
                    .instruction();
                invoke_as(
                    &state,
                    &[(kind, ctx.bumps.signer)],
                    &ix,
                    &[
                        a.signer.to_account_info(),
                        config.to_account_info(),
                        program.to_account_info(),
                    ],
                )?;
            },
            native => {
                let authority_type = match native {
                    SignerKind::PermissionedBurn => AuthorityType::PermissionedBurn,
                    SignerKind::PermanentDelegate => AuthorityType::PermanentDelegate,
                    SignerKind::Pause => AuthorityType::Pause,
                    SignerKind::TransferHook => AuthorityType::TransferHookProgramId,
                    SignerKind::Mint => AuthorityType::MintTokens,
                    SignerKind::Acl => unreachable!("handled above"),
                };
                let (program, mint) = (a.token_program.key(), a.mint.key());
                invoke_as_authority(
                    &state,
                    kind,
                    &a.signer,
                    ctx.bumps.signer,
                    a.multisig.as_deref(),
                    |authority, signers| {
                        spl_token_2022_interface::instruction::set_authority(
                            &program,
                            &mint,
                            Some(&new_authority),
                            authority_type,
                            authority,
                            signers,
                        )
                    },
                    vec![a.mint.to_account_info(), a.token_program.to_account_info()],
                )?;
            },
        }

        emit_cpi!(NativeAuthorityChanged {
            token_manager: state,
            kind: kind as u8,
            new_authority,
            authority: a.authority.key(),
        });
        Ok(())
    }
}
