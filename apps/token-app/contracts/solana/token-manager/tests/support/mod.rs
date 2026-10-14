#![allow(dead_code)]

use anchor_lang::{InstructionData, ToAccountMetas};
use futures::executor::block_on;
use mollusk_svm::{account_store::AccountStore, Mollusk, MolluskContext};
use mollusk_svm_programs_token::token2022;
use mollusk_svm_result::types::{TransactionProgramResult, TransactionResult};
use pubkey_policy::RoleType as PolicyRole;
use pubkey_policy_interface::{Membership, PubkeyPolicyMode, SubjectRecord};
use solana_account::Account;
use solana_instruction::Instruction;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;
use spl_token_2022::offchain::create_transfer_checked_instruction_with_extra_metas;
use spl_token_2022_interface::{
    extension::{
        default_account_state::instruction as das, transfer_hook::instruction as hook,
        ExtensionType, StateWithExtensions,
    },
    instruction as token,
    state::{Account as TokenAccount, AccountState, Mint},
};
use std::{
    collections::{HashMap, HashSet},
    future::ready,
    path::PathBuf,
};
use token_acl_client::{accounts::MintConfig, instructions as acl};
use token_manager::{InitTokenManagerParams, RoleType};
use token_manager_interface::SignerKind;

pub const SYSTEM: Pubkey = Pubkey::new_from_array([0; 32]);
pub const DECIMALS: u8 = 6;

#[derive(Clone, Copy)]
pub enum Mode {
    Plain,
    PermissionedBurn,
    Acl,
    Hook,
    AclHook,
    /// `AclHook` plus the Pausable extension, whose pause authority starts as `admin`.
    AclHookPausable,
    AclFees,
    AclConfidentialFees,
}

impl Mode {
    fn acl(self) -> bool {
        matches!(self, Self::Acl | Self::AclHook | Self::AclHookPausable | Self::AclFees)
            || self.confidential()
    }
    fn hook(self) -> bool {
        matches!(self, Self::Hook | Self::AclHook | Self::AclHookPausable)
    }
    fn pausable(self) -> bool {
        matches!(self, Self::AclHookPausable)
    }
    fn confidential(self) -> bool {
        matches!(self, Self::AclConfidentialFees)
    }
    fn fees(self) -> bool {
        matches!(self, Self::AclFees | Self::AclConfidentialFees)
    }
}

pub struct Fixture {
    pub context: MolluskContext<HashMap<Pubkey, Account>>,
    pub mode: Mode,
    pub admin: Pubkey,
    pub operator: Pubkey,
    pub keeper: Pubkey,
    pub mint: Pubkey,
    pub token_manager: Pubkey,
    /// The admin-created pubkey policy the ACL gate and hook bind.
    pub policy: Pubkey,
}

/// A subject record's flags, from its raw account data.
pub fn membership(data: &[u8]) -> anchor_lang::Result<Membership> {
    use anchor_lang::AccountDeserialize;
    SubjectRecord::try_deserialize(&mut &data[..]).map(|record| record.membership)
}

pub fn event_authority(program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], program).0
}

pub fn role_member(token_manager: &Pubkey, role: RoleType, member: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[rbac::ROLE_MEMBER_SEED, token_manager.as_ref(), &[role as u8], member.as_ref()],
        &token_manager::ID,
    )
    .0
}

pub fn policy_role_member(policy: &Pubkey, role: PolicyRole, member: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[rbac::ROLE_MEMBER_SEED, policy.as_ref(), &[role as u8], member.as_ref()],
        &pubkey_policy::ID,
    )
    .0
}

impl Fixture {
    pub fn new(mode: Mode) -> Self {
        let fixture = Self::uninitialized(mode);
        fixture.ok(&[
            fixture.init_token_manager_ix(fixture.admin, fixture.admin),
            fixture.accept_admin_ix(fixture.admin),
        ]);
        fixture.ok(&fixture.policy_ixs());
        fixture.ok(&[
            fixture.grant_role_ix(RoleType::Freezer, fixture.admin),
            fixture.grant_role_ix(RoleType::Thawer, fixture.admin),
        ]);
        if mode.acl() {
            fixture.ok(&[fixture.create_acl_config_ix()]);
            fixture.ok(&[
                acl::SetAuthorityBuilder::new()
                    .authority(fixture.admin)
                    .mint_config(fixture.mint_config())
                    .new_authority(fixture.acl_signer())
                    .instruction(),
                fixture.init_acl_ix(),
                fixture.acl_permissions_ix(true, true),
            ]);
        }
        if mode.hook() {
            fixture.ok(&[fixture.init_transfer_hook_ix()]);
        }
        fixture
    }

    /// Create an initialized Token-2022 mint, without a policy or ACL handoff.
    pub fn uninitialized(mode: Mode) -> Self {
        let deploy = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target/test-deploy");
        let mut svm = Mollusk::default();
        let mut programs =
            vec![(token_manager::ID, "token_manager"), (pubkey_policy::ID, "pubkey_policy")];
        if mode.acl() {
            programs.push((token_acl_interface::TOKEN_ACL_ID, "token_acl_fixture"));
        }
        if mode.hook() {
            programs.push((pubkey_policy_hook::ID, "pubkey_policy_hook"));
        }
        for (id, binary) in programs {
            assert!(
                deploy.join(format!("{binary}.so")).exists(),
                "Missing {binary}.so; run pnpm test:mollusk to build through VM tooling"
            );
            svm.add_program(&id, deploy.join(binary).to_str().unwrap());
        }
        svm.add_program(&token2022::ID, deploy.join("token_2022_fixture").to_str().unwrap());
        mollusk_svm_programs_token::associated_token::add_program(&mut svm);
        let admin = Pubkey::new_unique();
        let operator = Pubkey::new_unique();
        let keeper = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let token_manager = token_manager_interface::token_manager_address(&mint).0;
        let policy = pubkey_policy_interface::pubkey_policy_address(&mint, &admin).0;
        let fixture = Self {
            context: svm.with_context(HashMap::new()),
            mode,
            admin,
            operator,
            keeper,
            mint,
            token_manager,
            policy,
        };
        for key in [admin, operator, keeper] {
            fixture
                .context
                .account_store
                .borrow_mut()
                .insert(key, Account::new(10_000_000_000, 0, &SYSTEM));
        }

        fixture.create_mint();
        fixture
    }

    /// Execute instructions in one SVM transaction context (not an instruction
    /// chain). This is not validator submission or cryptographic signature verification.
    pub fn run(&self, instructions: &[Instruction]) -> TransactionResult {
        let mut seen = HashSet::new();
        let mut accounts = Vec::new();
        {
            let store = self.context.account_store.borrow();
            for ix in instructions {
                for meta in &ix.accounts {
                    if seen.insert(meta.pubkey) {
                        accounts.push((
                            meta.pubkey,
                            store
                                .get_account(&meta.pubkey)
                                .unwrap_or_else(|| store.default_account(&meta.pubkey)),
                        ));
                    }
                }
            }
        }
        let result =
            self.context
                .mollusk
                .process_transaction_instructions(instructions, &accounts, None);
        if result.program_result.is_ok() {
            let mut store = self.context.account_store.borrow_mut();
            for (key, account) in &result.resulting_accounts {
                store.insert(*key, account.clone());
            }
        } else {
            // Check the SVM API's returned state too, not merely our decision
            // not to commit a failed transaction into the fixture's store.
            assert_eq!(result.resulting_accounts, accounts, "Failed transaction must roll back");
        }
        result
    }

    pub fn ok(&self, instructions: &[Instruction]) {
        let result = self.run(instructions);
        assert_eq!(result.program_result, TransactionProgramResult::Success);
    }

    pub fn fails(&self, instructions: &[Instruction], index: usize, error: impl Into<u32>) {
        assert_eq!(
            self.run(instructions).program_result,
            TransactionProgramResult::Failure(index, ProgramError::Custom(error.into()))
        );
    }

    pub fn account(&self, key: &Pubkey) -> Account {
        self.context.account_store.borrow().get(key).cloned().unwrap_or_default()
    }

    pub fn token(&self, key: &Pubkey) -> TokenAccount {
        StateWithExtensions::<TokenAccount>::unpack(&self.account(key).data)
            .unwrap()
            .base
    }

    pub fn record(&self, subject: &Pubkey) -> Pubkey {
        pubkey_policy_interface::subject_address(&self.policy, subject).0
    }

    pub fn mint_config(&self) -> Pubkey {
        MintConfig::find_pda(&self.mint).0
    }

    pub fn acl_signer(&self) -> Pubkey {
        token_manager_interface::signer_address(&self.token_manager, SignerKind::Acl).0
    }

    pub fn pause_signer(&self) -> Pubkey {
        token_manager_interface::signer_address(&self.token_manager, SignerKind::Pause).0
    }

    /// `authority` (the live pause authority) pauses or resumes the mint.
    pub fn pause_ix(&self, authority: Pubkey, paused: bool) -> Instruction {
        use spl_token_2022_interface::extension::pausable::instruction as pausable;
        let toggle = if paused { pausable::pause } else { pausable::resume };
        toggle(&token2022::ID, &self.mint, &authority, &[]).unwrap()
    }

    pub fn paused(&self) -> bool {
        use spl_token_2022_interface::extension::{
            pausable::PausableConfig, BaseStateWithExtensions,
        };
        let data = self.account(&self.mint).data;
        let mint = StateWithExtensions::<Mint>::unpack(&data).unwrap();
        mint.get_extension::<PausableConfig>().unwrap().paused.into()
    }

    pub fn pb_signer(&self) -> Pubkey {
        token_manager_interface::signer_address(&self.token_manager, SignerKind::PermissionedBurn).0
    }

    /// `authority` must be one of the mint's live native authorities (freeze, mint, PB, PD);
    /// fixture mints use `admin` for all of them.
    pub fn init_token_manager_ix(&self, authority: Pubkey, pending_admin: Pubkey) -> Instruction {
        let accounts = token_manager::accounts::InitTokenManager {
            payer: self.admin,
            authority,
            mint: self.mint,
            mint_config: Some(self.mint_config()),
            token_manager: self.token_manager,
            system_program: SYSTEM,
            event_authority: event_authority(&token_manager::ID),
            program: token_manager::ID,
        }
        .to_account_metas(None);
        let mut accounts = accounts;
        if let Some(meta) = accounts.iter_mut().find(|m| m.pubkey == authority) {
            meta.is_signer = true;
        }
        Instruction {
            program_id: token_manager::ID,
            accounts,
            data: token_manager::instruction::InitTokenManager {
                params: InitTokenManagerParams { pending_admin },
            }
            .data(),
        }
    }

    pub fn accept_admin_ix(&self, admin: Pubkey) -> Instruction {
        Instruction {
            program_id: token_manager::ID,
            accounts: token_manager::accounts::AcceptTokenManagerAdmin {
                payer: self.admin,
                admin,
                token_manager: self.token_manager,
                system_program: SYSTEM,
                admin_role_member: role_member(&self.token_manager, RoleType::DefaultAdmin, &admin),
                event_authority: event_authority(&token_manager::ID),
                program: token_manager::ID,
            }
            .to_account_metas(None),
            data: token_manager::instruction::AcceptTokenManagerAdmin {}.data(),
        }
    }

    pub fn set_pending_admin_ix(&self, authority: Pubkey, pending_admin: Pubkey) -> Instruction {
        let mut accounts = token_manager::accounts::SetPendingTokenManagerAdmin {
            authority,
            token_manager: self.token_manager,
            event_authority: event_authority(&token_manager::ID),
            program: token_manager::ID,
        }
        .to_account_metas(None);
        accounts[0].is_signer = true;
        Instruction {
            program_id: token_manager::ID,
            accounts,
            data: token_manager::instruction::SetPendingTokenManagerAdmin { pending_admin }.data(),
        }
    }

    pub fn create_acl_config_ix(&self) -> Instruction {
        acl::CreateConfigBuilder::new()
            .payer(self.admin)
            .authority(self.admin)
            .mint(self.mint)
            .mint_config(self.mint_config())
            .gating_program(token_manager::ID)
            .instruction()
    }

    /// The fixture's Blacklist policy with `operator` as Blacklister and Whitelister.
    pub fn policy_ixs(&self) -> [Instruction; 3] {
        [
            self.init_policy_ix(self.admin, PubkeyPolicyMode::Blacklist),
            self.grant_policy_role_ix(PolicyRole::Blacklister, self.operator),
            self.grant_policy_role_ix(PolicyRole::Whitelister, self.operator),
        ]
    }

    /// `initializer` signs and becomes the policy's DefaultAdmin.
    pub fn init_policy_ix(&self, initializer: Pubkey, mode: PubkeyPolicyMode) -> Instruction {
        self.init_policy_ix_for(self.mint, initializer, mode)
    }

    /// Anyone may create a policy for any mint; `mint` need not exist.
    pub fn init_policy_ix_for(
        &self,
        mint: Pubkey,
        initializer: Pubkey,
        mode: PubkeyPolicyMode,
    ) -> Instruction {
        let policy = pubkey_policy_interface::pubkey_policy_address(&mint, &initializer).0;
        Instruction {
            program_id: pubkey_policy::ID,
            accounts: pubkey_policy::accounts::InitPubkeyPolicy {
                payer: self.admin,
                initializer,
                policy,
                system_program: SYSTEM,
                admin_role_member: policy_role_member(
                    &policy,
                    PolicyRole::DefaultAdmin,
                    &initializer,
                ),
                event_authority: event_authority(&pubkey_policy::ID),
                program: pubkey_policy::ID,
            }
            .to_account_metas(None),
            data: pubkey_policy::instruction::InitPubkeyPolicy {
                params: pubkey_policy::InitPubkeyPolicyParams { mint, admin: initializer, mode },
            }
            .data(),
        }
    }

    pub fn grant_policy_role_ix(&self, role: PolicyRole, member: Pubkey) -> Instruction {
        Instruction {
            program_id: pubkey_policy::ID,
            accounts: pubkey_policy::accounts::StdGrantRole {
                authority: self.admin,
                payer: self.admin,
                default_admin: self.policy,
                role_admin_member: policy_role_member(
                    &self.policy,
                    PolicyRole::DefaultAdmin,
                    &self.admin,
                ),
                role_member: policy_role_member(&self.policy, role, &member),
                system_program: SYSTEM,
                event_authority: event_authority(&pubkey_policy::ID),
                program: pubkey_policy::ID,
            }
            .to_account_metas(None),
            data: pubkey_policy::instruction::GrantRole {
                params: rbac::types::GrantRoleParams { role, account: member },
            }
            .data(),
        }
    }

    pub fn grant_role_ix(&self, role: RoleType, member: Pubkey) -> Instruction {
        Instruction {
            program_id: token_manager::ID,
            accounts: token_manager::accounts::StdGrantRole {
                authority: self.admin,
                payer: self.admin,
                default_admin: self.token_manager,
                role_admin_member: role_member(
                    &self.token_manager,
                    RoleType::DefaultAdmin,
                    &self.admin,
                ),
                role_member: role_member(&self.token_manager, role, &member),
                system_program: SYSTEM,
                event_authority: event_authority(&token_manager::ID),
                program: token_manager::ID,
            }
            .to_account_metas(None),
            data: token_manager::instruction::GrantRole {
                params: rbac::types::GrantRoleParams { role, account: member },
            }
            .data(),
        }
    }

    pub fn block_ix(&self, subject: Pubkey, blocked: bool) -> Instruction {
        self.blacklist_ix(subject, blocked)
    }

    pub fn blacklist_ix(&self, subject: Pubkey, blacklisted: bool) -> Instruction {
        Instruction {
            program_id: pubkey_policy::ID,
            accounts: pubkey_policy::accounts::SetBlacklisted {
                payer: self.admin,
                authority: self.operator,
                policy: self.policy,
                record: self.record(&subject),
                system_program: SYSTEM,
                role_member: policy_role_member(
                    &self.policy,
                    PolicyRole::Blacklister,
                    &self.operator,
                ),
                event_authority: event_authority(&pubkey_policy::ID),
                program: pubkey_policy::ID,
            }
            .to_account_metas(None),
            data: pubkey_policy::instruction::SetBlacklisted {
                params: pubkey_policy::SetBlacklistedParams { subject, blacklisted },
            }
            .data(),
        }
    }

    pub fn whitelist_ix(&self, subject: Pubkey, whitelisted: bool) -> Instruction {
        Instruction {
            program_id: pubkey_policy::ID,
            accounts: pubkey_policy::accounts::SetWhitelisted {
                payer: self.admin,
                authority: self.operator,
                policy: self.policy,
                record: self.record(&subject),
                system_program: SYSTEM,
                role_member: policy_role_member(
                    &self.policy,
                    PolicyRole::Whitelister,
                    &self.operator,
                ),
                event_authority: event_authority(&pubkey_policy::ID),
                program: pubkey_policy::ID,
            }
            .to_account_metas(None),
            data: pubkey_policy::instruction::SetWhitelisted {
                params: pubkey_policy::SetWhitelistedParams { subject, whitelisted },
            }
            .data(),
        }
    }

    /// Only the bits that differ from the default. A fresh subject already reads as all-false,
    /// and a write that changes nothing is rejected.
    pub fn membership_ixs(&self, subject: Pubkey, membership: Membership) -> Vec<Instruction> {
        let mut instructions = Vec::new();
        if membership.blacklisted {
            instructions.push(self.blacklist_ix(subject, true));
        }
        if membership.whitelisted {
            instructions.push(self.whitelist_ix(subject, true));
        }
        instructions
    }

    pub fn block(&self, subject: Pubkey, blocked: bool) {
        self.ok(&[self.block_ix(subject, blocked)]);
    }

    pub fn set_mode_ix(&self, mode: PubkeyPolicyMode) -> Instruction {
        Instruction {
            program_id: pubkey_policy::ID,
            accounts: pubkey_policy::accounts::SetMode {
                authority: self.admin,
                policy: self.policy,
                role_member: policy_role_member(
                    &self.policy,
                    PolicyRole::DefaultAdmin,
                    &self.admin,
                ),
                event_authority: event_authority(&pubkey_policy::ID),
                program: pubkey_policy::ID,
            }
            .to_account_metas(None),
            data: pubkey_policy::instruction::SetMode { mode }.data(),
        }
    }

    pub fn manage_acl_accounts(&self) -> Vec<solana_instruction::AccountMeta> {
        token_manager::accounts::ManageAcl {
            authority: self.admin,
            token_manager: self.token_manager,
            acl_signer: self.acl_signer(),
            mint_config: self.mint_config(),
            acl_program: token_acl_interface::TOKEN_ACL_ID,
            role_member: role_member(&self.token_manager, RoleType::DefaultAdmin, &self.admin),
            event_authority: event_authority(&token_manager::ID),
            program: token_manager::ID,
        }
        .to_account_metas(None)
    }

    /// DefaultAdmin moves `kind`'s native authority off this root's signer PDA to `new_authority`.
    pub fn set_native_authority_ix(&self, kind: SignerKind, new_authority: Pubkey) -> Instruction {
        self.set_native_authority_via_ix(kind, new_authority, None)
    }

    /// As [`Self::set_native_authority_ix`], with the authority held by `multisig`, a native
    /// multisig the signer PDA is a member of.
    pub fn set_native_authority_via_ix(
        &self,
        kind: SignerKind,
        new_authority: Pubkey,
        multisig: Option<Pubkey>,
    ) -> Instruction {
        let acl = matches!(kind, SignerKind::Acl);
        Instruction {
            program_id: token_manager::ID,
            accounts: token_manager::accounts::SetNativeAuthority {
                authority: self.admin,
                token_manager: self.token_manager,
                signer: token_manager_interface::signer_address(&self.token_manager, kind).0,
                multisig,
                mint: self.mint,
                mint_config: acl.then(|| self.mint_config()),
                acl_program: acl.then_some(token_acl_interface::TOKEN_ACL_ID),
                token_program: token2022::ID,
                role_member: role_member(&self.token_manager, RoleType::DefaultAdmin, &self.admin),
                event_authority: event_authority(&token_manager::ID),
                program: token_manager::ID,
            }
            .to_account_metas(None),
            data: token_manager::instruction::SetNativeAuthority { kind, new_authority }.data(),
        }
    }

    /// Renouncing PB is not a TokenManager operation: hand the authority to the admin, who nulls
    /// it natively in the same transaction.
    pub fn renounce_pb_ixs(&self) -> Vec<Instruction> {
        vec![
            self.set_native_authority_ix(SignerKind::PermissionedBurn, self.admin),
            token::set_authority(
                &token2022::ID,
                &self.mint,
                None,
                token::AuthorityType::PermissionedBurn,
                &self.admin,
                &[],
            )
            .unwrap(),
        ]
    }

    pub fn acl_permissions_ix(&self, freeze_enabled: bool, thaw_enabled: bool) -> Instruction {
        Instruction {
            program_id: token_manager::ID,
            accounts: self.manage_acl_accounts(),
            data: token_manager::instruction::SetAclPermissions {
                params: token_manager::AclPermissions { freeze_enabled, thaw_enabled },
            }
            .data(),
        }
    }

    pub fn acl_gating_program_ix(&self, gating_program: Pubkey) -> Instruction {
        Instruction {
            program_id: token_manager::ID,
            accounts: self.manage_acl_accounts(),
            data: token_manager::instruction::SetAclGatingProgram { gating_program }.data(),
        }
    }

    pub fn current_admin(&self) -> Pubkey {
        use anchor_lang::AccountDeserialize;
        token_manager_interface::TokenManagerStore::try_deserialize(
            &mut self.account(&self.token_manager).data.as_slice(),
        )
        .unwrap()
        .current_default_admin
    }

    /// Adapt a fixture admin instruction without granting any operational role.
    pub fn as_current_admin(&self, mut ix: Instruction) -> Instruction {
        let current = self.current_admin();
        for meta in &mut ix.accounts {
            if meta.pubkey == self.admin {
                meta.pubkey = current;
            } else if meta.pubkey
                == role_member(&self.token_manager, RoleType::DefaultAdmin, &self.admin)
            {
                meta.pubkey = role_member(&self.token_manager, RoleType::DefaultAdmin, &current);
            }
        }
        ix
    }

    pub fn begin_default_admin_transfer_ix(&self, new_admin: Pubkey) -> Instruction {
        Instruction {
            program_id: token_manager::ID,
            accounts: token_manager::accounts::StdBeginDefaultAdminTransfer {
                authority: self.current_admin(),
                default_admin: self.token_manager,
                event_authority: event_authority(&token_manager::ID),
                program: token_manager::ID,
            }
            .to_account_metas(None),
            data: token_manager::instruction::BeginDefaultAdminTransfer { params: new_admin }
                .data(),
        }
    }

    pub fn accept_default_admin_transfer_ix(&self, authority: Pubkey) -> Instruction {
        Instruction {
            program_id: token_manager::ID,
            accounts: token_manager::accounts::StdAcceptDefaultAdminTransfer {
                authority,
                payer: self.admin,
                default_admin: self.token_manager,
                old_admin_role_member: role_member(
                    &self.token_manager,
                    RoleType::DefaultAdmin,
                    &self.current_admin(),
                ),
                new_admin_role_member: role_member(
                    &self.token_manager,
                    RoleType::DefaultAdmin,
                    &authority,
                ),
                system_program: SYSTEM,
                event_authority: event_authority(&token_manager::ID),
                program: token_manager::ID,
            }
            .to_account_metas(None),
            data: token_manager::instruction::AcceptDefaultAdminTransfer {}.data(),
        }
    }

    pub fn rotate_default_admin(&self, new_admin: Pubkey) {
        self.ok(&[
            self.begin_default_admin_transfer_ix(new_admin),
            self.accept_default_admin_transfer_ix(new_admin),
        ]);
    }

    pub fn revoke_role_ix(&self, role: RoleType, member: Pubkey) -> Instruction {
        Instruction {
            program_id: token_manager::ID,
            accounts: token_manager::accounts::StdRevokeRole {
                authority: self.current_admin(),
                receiver: self.admin,
                default_admin: self.token_manager,
                role_admin_member: role_member(
                    &self.token_manager,
                    RoleType::DefaultAdmin,
                    &self.current_admin(),
                ),
                role_member: role_member(&self.token_manager, role, &member),
                event_authority: event_authority(&token_manager::ID),
                program: token_manager::ID,
            }
            .to_account_metas(None),
            data: token_manager::instruction::RevokeRole {
                params: rbac::types::RevokeRoleParams { role, account: member },
            }
            .data(),
        }
    }

    pub fn admin_freeze(
        &self,
        token_account: Pubkey,
        freeze: bool,
        authority: Pubkey,
    ) -> Instruction {
        let role = if freeze { RoleType::Freezer } else { RoleType::Thawer };
        // The two explicit contexts have the same fields, but different RBAC roles.
        let accounts = token_manager::accounts::FreezeTokenAccount {
            authority,
            token_manager: self.token_manager,
            acl_signer: self.acl_signer(),
            mint: self.mint,
            token_account,
            mint_config: self.mint_config(),
            acl_program: token_acl_interface::TOKEN_ACL_ID,
            token_program: token2022::ID,
            role_member: role_member(&self.token_manager, role, &authority),
            event_authority: event_authority(&token_manager::ID),
            program: token_manager::ID,
        }
        .to_account_metas(None);
        Instruction {
            program_id: token_manager::ID,
            accounts,
            data: if freeze {
                token_manager::instruction::FreezeTokenAccount {}.data()
            } else {
                token_manager::instruction::ThawTokenAccount {}.data()
            },
        }
    }

    pub fn init_acl_ix(&self) -> Instruction {
        Instruction {
            program_id: token_manager::ID,
            accounts: token_manager::accounts::InitAcl {
                payer: self.admin,
                authority: self.admin,
                mint: self.mint,
                token_manager: self.token_manager,
                pubkey_policy: self.policy,
                thaw_metas: token_acl_interface::get_thaw_extra_account_metas_address(
                    &self.mint,
                    &token_manager::ID,
                ),
                freeze_metas: token_acl_interface::get_freeze_extra_account_metas_address(
                    &self.mint,
                    &token_manager::ID,
                ),
                system_program: SYSTEM,
                role_member: role_member(&self.token_manager, RoleType::DefaultAdmin, &self.admin),
                event_authority: event_authority(&token_manager::ID),
                program: token_manager::ID,
            }
            .to_account_metas(None),
            data: token_manager::instruction::InitAcl {}.data(),
        }
    }

    pub fn init_transfer_hook_ix(&self) -> Instruction {
        Instruction {
            program_id: pubkey_policy_hook::ID,
            accounts: pubkey_policy_hook::accounts::InitTransferHook {
                payer: self.admin,
                authority: self.admin,
                mint: self.mint,
                pubkey_policy: self.policy,
                extra_account_metas: spl_transfer_hook_interface::get_extra_account_metas_address(
                    &self.mint,
                    &pubkey_policy_hook::ID,
                ),
                system_program: SYSTEM,
                event_authority: event_authority(&pubkey_policy_hook::ID),
                program: pubkey_policy_hook::ID,
            }
            .to_account_metas(None)
            .into_iter()
            .map(|mut meta| {
                // The hook authority is authenticated in the handler, so it is not typed a Signer.
                meta.is_signer |= meta.pubkey == self.admin;
                meta
            })
            .collect(),
            data: pubkey_policy_hook::instruction::InitTransferHook {}.data(),
        }
    }

    fn create_mint(&self) {
        let mut extensions = vec![];
        if matches!(self.mode, Mode::PermissionedBurn) {
            extensions.extend([ExtensionType::PermissionedBurn, ExtensionType::PermanentDelegate]);
        }
        if self.mode.acl() {
            extensions.push(ExtensionType::DefaultAccountState);
        }
        if self.mode.hook() {
            extensions.extend([ExtensionType::TransferHook, ExtensionType::PermanentDelegate]);
        }
        if self.mode.fees() {
            extensions.push(ExtensionType::TransferFeeConfig);
        }
        if self.mode.pausable() {
            extensions.push(ExtensionType::Pausable);
        }
        if self.mode.confidential() {
            extensions.extend([
                ExtensionType::ConfidentialTransferMint,
                ExtensionType::ConfidentialTransferFeeConfig,
            ]);
        }
        let size = ExtensionType::try_calculate_account_len::<Mint>(&extensions).unwrap();
        let mut instructions = vec![solana_system_interface::instruction::create_account(
            &self.admin,
            &self.mint,
            self.context.mollusk.sysvars.rent.minimum_balance(size),
            size as u64,
            &token2022::ID,
        )];
        if matches!(self.mode, Mode::PermissionedBurn) {
            instructions.push(
                spl_token_2022_interface::extension::permissioned_burn::instruction::initialize(
                    &token2022::ID,
                    &self.mint,
                    &self.admin,
                )
                .unwrap(),
            );
            instructions.push(
                token::initialize_permanent_delegate(&token2022::ID, &self.mint, &self.admin)
                    .unwrap(),
            );
        }
        if self.mode.acl() {
            instructions.push(
                das::initialize_default_account_state(
                    &token2022::ID,
                    &self.mint,
                    &AccountState::Frozen,
                )
                .unwrap(),
            );
        }
        if self.mode.hook() {
            instructions.push(
                hook::initialize(
                    &token2022::ID,
                    &self.mint,
                    Some(self.admin),
                    Some(pubkey_policy_hook::ID),
                )
                .unwrap(),
            );
            instructions.push(
                token::initialize_permanent_delegate(&token2022::ID, &self.mint, &self.admin)
                    .unwrap(),
            );
        }
        if self.mode.pausable() {
            instructions.push(
                spl_token_2022_interface::extension::pausable::instruction::initialize(
                    &token2022::ID,
                    &self.mint,
                    &self.admin,
                )
                .unwrap(),
            );
        }
        if self.mode.fees() {
            instructions.push(spl_token_2022_interface::extension::transfer_fee::instruction::initialize_transfer_fee_config(
                &token2022::ID, &self.mint, Some(&self.admin), Some(&self.admin), 100, 1000).unwrap());
        }
        if self.mode.confidential() {
            instructions.push(spl_token_2022_interface::extension::confidential_transfer::instruction::initialize_mint(
                &token2022::ID, &self.mint, Some(self.admin), false, None).unwrap());
            instructions.push(spl_token_2022_interface::extension::confidential_transfer_fee::instruction::initialize_confidential_transfer_fee_config(
                &token2022::ID, &self.mint, Some(self.admin), &Default::default()).unwrap());
        }
        instructions.push(
            token::initialize_mint2(
                &token2022::ID,
                &self.mint,
                &self.admin,
                Some(&self.admin),
                DECIMALS,
            )
            .unwrap(),
        );
        self.ok(&instructions);
    }

    pub fn create_token_ixs(&self, address: Pubkey, owner: Pubkey) -> Vec<Instruction> {
        let mint_data = self.account(&self.mint).data;
        let size = spl_token_2022_interface::extension::account_len::try_calculate_account_len_from_mint_data(
            &mint_data, &[],
        ).unwrap();
        vec![
            solana_system_interface::instruction::create_account(
                &self.admin,
                &address,
                self.context.mollusk.sysvars.rent.minimum_balance(size),
                size as u64,
                &token2022::ID,
            ),
            token::initialize_account3(&token2022::ID, &address, &self.mint, &owner).unwrap(),
        ]
    }

    pub fn create_token(&self, owner: Pubkey) -> Pubkey {
        let address = Pubkey::new_unique();
        self.ok(&self.create_token_ixs(address, owner));
        address
    }

    /// A native `m`-of-n Token-2022 multisig over `members`.
    pub fn native_multisig(&self, members: &[&Pubkey], m: u8) -> Pubkey {
        use solana_program_pack::Pack;
        use spl_token_2022_interface::state::Multisig;
        let multisig = Pubkey::new_unique();
        self.ok(&[
            solana_system_interface::instruction::create_account(
                &self.admin,
                &multisig,
                self.context.mollusk.sysvars.rent.minimum_balance(Multisig::LEN),
                Multisig::LEN as u64,
                &token2022::ID,
            ),
            token::initialize_multisig2(&token2022::ID, &multisig, members, m).unwrap(),
        ]);
        multisig
    }

    pub fn mint_to(&self, destination: Pubkey, amount: u64) {
        self.ok(&[token::mint_to(
            &token2022::ID,
            &self.mint,
            &destination,
            &self.admin,
            &[],
            amount,
        )
        .unwrap()]);
    }

    pub fn transfer(
        &self,
        source: Pubkey,
        destination: Pubkey,
        authority: Pubkey,
        amount: u64,
    ) -> Instruction {
        block_on(create_transfer_checked_instruction_with_extra_metas(
            &token2022::ID,
            &source,
            &self.mint,
            &destination,
            &authority,
            &[],
            amount,
            DECIMALS,
            |key| ready(Ok(self.context.account_store.borrow().get(&key).map(|a| a.data.clone()))),
        ))
        .unwrap()
    }

    pub fn acl(&self, token_account: Pubkey, owner: Pubkey, freeze: bool) -> Instruction {
        let fetch =
            |key| ready(Ok(self.context.account_store.borrow().get(&key).map(|a| a.data.clone())));
        if freeze {
            block_on(token_acl_client::create_freeze_permissionless_instruction_with_extra_metas(
                &self.keeper,
                &token_account,
                &self.mint,
                &self.mint_config(),
                &token2022::ID,
                &owner,
                false,
                fetch,
            ))
            .unwrap()
        } else {
            block_on(token_acl_client::create_thaw_permissionless_instruction_with_extra_metas(
                &self.keeper,
                &token_account,
                &self.mint,
                &self.mint_config(),
                &token2022::ID,
                &owner,
                false,
                fetch,
            ))
            .unwrap()
        }
    }

    pub fn native_freeze(&self, token_account: Pubkey, freeze: bool) -> Instruction {
        if freeze {
            token::freeze_account(&token2022::ID, &token_account, &self.mint, &self.admin, &[])
                .unwrap()
        } else {
            token::thaw_account(&token2022::ID, &token_account, &self.mint, &self.admin, &[])
                .unwrap()
        }
    }
}

/// Native error codes the suites pin, for programs whose error enums the tests don't link.
/// System Program `AccountAlreadyInUse`: an `init` whose address already holds an account.
pub const SYSTEM_ACCOUNT_ALREADY_IN_USE: u32 = 0;
/// Token ACL `InvalidAuthority`: the signer is not the MintConfig's logical admin.
pub const ACL_INVALID_AUTHORITY: u32 = 0;
/// Token ACL `PermissionlessThawNotEnabled`.
pub const ACL_PERMISSIONLESS_THAW_NOT_ENABLED: u32 = 6;
/// spl-tlv-account-resolution `IncorrectAccount`: a supplied extra does not match the manifest.
pub const ACCOUNT_RESOLUTION_INCORRECT_ACCOUNT: u32 = 2_724_315_840;
