use anchor_lang::{AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas};
use mollusk_svm::{account_store::AccountStore, Mollusk, MolluskContext};
use mollusk_svm_result::types::{TransactionProgramResult, TransactionResult};
use pubkey_policy::RoleType;
use pubkey_policy_interface::{
    pubkey_policy_address, subject_address, Membership, PubkeyPolicyMode, SubjectRecord,
};
use solana_account::Account;
use solana_instruction::Instruction;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
};

pub const SYSTEM: Pubkey = Pubkey::new_from_array([0; 32]);

/// `admin` creates and administers `policy`; `operator` holds Blacklister and Whitelister.
/// `keeper` is an unrelated wallet. `mint` need not exist: policies only namespace by it.
pub struct Fixture {
    pub context: MolluskContext<HashMap<Pubkey, Account>>,
    pub admin: Pubkey,
    pub operator: Pubkey,
    pub keeper: Pubkey,
    pub mint: Pubkey,
    pub policy: Pubkey,
}

/// A subject record's flags, from its raw account data.
pub fn membership(data: &[u8]) -> Result<Membership, anchor_lang::error::Error> {
    use anchor_lang::AccountDeserialize;
    SubjectRecord::try_deserialize(&mut &data[..]).map(|record| record.membership)
}

pub fn event_authority() -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], &pubkey_policy::ID).0
}

pub fn policy_role_member(policy: &Pubkey, role: RoleType, member: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[rbac::ROLE_MEMBER_SEED, policy.as_ref(), &[role as u8], member.as_ref()],
        &pubkey_policy::ID,
    )
    .0
}

impl Fixture {
    pub fn new() -> Self {
        let f = Self::uninitialized();
        f.ok(&[
            f.init_policy_ix(f.admin, PubkeyPolicyMode::Blacklist),
            f.grant_role_ix(&f.policy, f.admin, RoleType::Blacklister, f.operator),
            f.grant_role_ix(&f.policy, f.admin, RoleType::Whitelister, f.operator),
        ]);
        f
    }

    pub fn uninitialized() -> Self {
        let deploy = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target/test-deploy");
        assert!(
            deploy.join("pubkey_policy.so").exists(),
            "Missing pubkey_policy.so; run pnpm test:mollusk to build through VM tooling"
        );
        let mut svm = Mollusk::default();
        svm.add_program(&pubkey_policy::ID, deploy.join("pubkey_policy").to_str().unwrap());
        let (admin, operator, keeper, mint) = (
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
        );
        let f = Self {
            context: svm.with_context(HashMap::new()),
            admin,
            operator,
            keeper,
            mint,
            policy: pubkey_policy_address(&mint, &admin).0,
        };
        for key in [admin, operator, keeper] {
            f.context
                .account_store
                .borrow_mut()
                .insert(key, Account::new(10_000_000_000, 0, &SYSTEM));
        }
        f
    }

    /// One SVM transaction; a failed transaction must leave every input account unchanged.
    pub fn run(&self, instructions: &[Instruction]) -> TransactionResult {
        let mut seen = HashSet::new();
        let accounts: Vec<_> = {
            let store = self.context.account_store.borrow();
            instructions
                .iter()
                .flat_map(|ix| &ix.accounts)
                .filter(|meta| seen.insert(meta.pubkey))
                .map(|meta| {
                    let account = store
                        .get_account(&meta.pubkey)
                        .unwrap_or_else(|| store.default_account(&meta.pubkey));
                    (meta.pubkey, account)
                })
                .collect()
        };
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
            assert_eq!(result.resulting_accounts, accounts, "Failed transaction must roll back");
        }
        result
    }

    pub fn ok(&self, instructions: &[Instruction]) {
        assert_eq!(self.run(instructions).program_result, TransactionProgramResult::Success);
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

    pub fn state(&self, policy: &Pubkey) -> pubkey_policy_interface::PubkeyPolicy {
        use anchor_lang::AccountDeserialize;
        pubkey_policy_interface::PubkeyPolicy::try_deserialize(
            &mut self.account(policy).data.as_slice(),
        )
        .unwrap()
    }

    pub fn record(&self, subject: &Pubkey) -> Pubkey {
        subject_address(&self.policy, subject).0
    }

    pub fn init_policy_ix(&self, initializer: Pubkey, mode: PubkeyPolicyMode) -> Instruction {
        self.init_ix(self.mint, initializer, initializer, mode)
    }

    /// `initializer` signs and namespaces the policy; `admin` becomes its DefaultAdmin directly.
    pub fn init_ix(
        &self,
        mint: Pubkey,
        initializer: Pubkey,
        admin: Pubkey,
        mode: PubkeyPolicyMode,
    ) -> Instruction {
        let policy = pubkey_policy_address(&mint, &initializer).0;
        Instruction {
            program_id: pubkey_policy::ID,
            accounts: pubkey_policy::accounts::InitPubkeyPolicy {
                payer: initializer,
                initializer,
                policy,
                system_program: SYSTEM,
                admin_role_member: policy_role_member(&policy, RoleType::DefaultAdmin, &admin),
                event_authority: event_authority(),
                program: pubkey_policy::ID,
            }
            .to_account_metas(None),
            data: pubkey_policy::instruction::InitPubkeyPolicy {
                params: pubkey_policy::InitPubkeyPolicyParams { mint, admin, mode },
            }
            .data(),
        }
    }

    pub fn grant_role_ix(
        &self,
        policy: &Pubkey,
        admin: Pubkey,
        role: RoleType,
        member: Pubkey,
    ) -> Instruction {
        Instruction {
            program_id: pubkey_policy::ID,
            accounts: pubkey_policy::accounts::StdGrantRole {
                authority: admin,
                payer: admin,
                default_admin: *policy,
                role_admin_member: policy_role_member(policy, RoleType::DefaultAdmin, &admin),
                role_member: policy_role_member(policy, role, &member),
                system_program: SYSTEM,
                event_authority: event_authority(),
                program: pubkey_policy::ID,
            }
            .to_account_metas(None),
            data: pubkey_policy::instruction::GrantRole {
                params: rbac::types::GrantRoleParams { role, account: member },
            }
            .data(),
        }
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
                    RoleType::Blacklister,
                    &self.operator,
                ),
                event_authority: event_authority(),
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
                    RoleType::Whitelister,
                    &self.operator,
                ),
                event_authority: event_authority(),
                program: pubkey_policy::ID,
            }
            .to_account_metas(None),
            data: pubkey_policy::instruction::SetWhitelisted {
                params: pubkey_policy::SetWhitelistedParams { subject, whitelisted },
            }
            .data(),
        }
    }

    pub fn block_ix(&self, subject: Pubkey, blocked: bool) -> Instruction {
        self.blacklist_ix(subject, blocked)
    }

    pub fn block(&self, subject: Pubkey, blocked: bool) {
        self.ok(&[self.block_ix(subject, blocked)]);
    }

    pub fn set_mode_ix(&self, mode: PubkeyPolicyMode) -> Instruction {
        self.set_mode_ix_for(&self.policy, self.admin, mode)
    }

    pub fn set_mode_ix_for(
        &self,
        policy: &Pubkey,
        admin: Pubkey,
        mode: PubkeyPolicyMode,
    ) -> Instruction {
        Instruction {
            program_id: pubkey_policy::ID,
            accounts: pubkey_policy::accounts::SetMode {
                authority: admin,
                policy: *policy,
                role_member: policy_role_member(policy, RoleType::DefaultAdmin, &admin),
                event_authority: event_authority(),
                program: pubkey_policy::ID,
            }
            .to_account_metas(None),
            data: pubkey_policy::instruction::SetMode { mode }.data(),
        }
    }

    pub fn begin_admin_transfer_ix(&self, admin: Pubkey, new_admin: Pubkey) -> Instruction {
        Instruction {
            program_id: pubkey_policy::ID,
            accounts: pubkey_policy::accounts::StdBeginDefaultAdminTransfer {
                authority: admin,
                default_admin: self.policy,
                event_authority: event_authority(),
                program: pubkey_policy::ID,
            }
            .to_account_metas(None),
            data: pubkey_policy::instruction::BeginDefaultAdminTransfer { params: new_admin }
                .data(),
        }
    }

    pub fn accept_admin_transfer_ix(&self, old_admin: Pubkey, new_admin: Pubkey) -> Instruction {
        Instruction {
            program_id: pubkey_policy::ID,
            accounts: pubkey_policy::accounts::StdAcceptDefaultAdminTransfer {
                authority: new_admin,
                payer: new_admin,
                default_admin: self.policy,
                old_admin_role_member: policy_role_member(
                    &self.policy,
                    RoleType::DefaultAdmin,
                    &old_admin,
                ),
                new_admin_role_member: policy_role_member(
                    &self.policy,
                    RoleType::DefaultAdmin,
                    &new_admin,
                ),
                system_program: SYSTEM,
                event_authority: event_authority(),
                program: pubkey_policy::ID,
            }
            .to_account_metas(None),
            data: pubkey_policy::instruction::AcceptDefaultAdminTransfer {}.data(),
        }
    }

    pub fn revoke_role_ix(&self, admin: Pubkey, role: RoleType, member: Pubkey) -> Instruction {
        Instruction {
            program_id: pubkey_policy::ID,
            accounts: pubkey_policy::accounts::StdRevokeRole {
                authority: admin,
                receiver: admin,
                default_admin: self.policy,
                role_admin_member: policy_role_member(&self.policy, RoleType::DefaultAdmin, &admin),
                role_member: policy_role_member(&self.policy, role, &member),
                event_authority: event_authority(),
                program: pubkey_policy::ID,
            }
            .to_account_metas(None),
            data: pubkey_policy::instruction::RevokeRole {
                params: rbac::types::RevokeRoleParams { role, account: member },
            }
            .data(),
        }
    }

    /// Anchor `emit_cpi!` events of type `T`, in emission order. Each is a self-CPI whose data is
    /// the 8-byte event-instruction tag, the event discriminator, then the borsh payload.
    pub fn events<T: AnchorDeserialize + Discriminator>(result: &TransactionResult) -> Vec<T> {
        result
            .inner_instructions
            .iter()
            .flatten()
            .filter_map(|inner| {
                let data = &inner.instruction.data;
                (data.get(8..16) == Some(T::DISCRIMINATOR))
                    .then(|| T::try_from_slice(&data[16..]).unwrap())
            })
            .collect()
    }

    /// Substitute `from` by `to` wherever it appears as an account key.
    pub fn with_key(mut ix: Instruction, from: Pubkey, to: Pubkey) -> Instruction {
        for meta in &mut ix.accounts {
            if meta.pubkey == from {
                meta.pubkey = to;
            }
        }
        ix
    }
}
