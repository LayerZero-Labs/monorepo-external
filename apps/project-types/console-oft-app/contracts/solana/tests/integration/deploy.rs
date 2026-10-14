//! Deploying a Console OFT for one token configuration through the real programs only.
//!
//! The rest of the suite starts from a fixture-written OFT (store, escrow, roles, peer); this path
//! creates every OFT, TokenManager, Token ACL and hook account with its own instruction, following
//! `docs/usage.md`'s setup order, `init_console_oft` included. A configuration is deployable when
//! this succeeds and a first receive and a send then work. Endpoint and message-library state stay
//! seeded, as everywhere in this suite.
use crate::harness::*;
use ::oft::types::OftType;
use console_oft::state::RoleType as OftRole;
use solana_program_pack::Pack;
use spl_token_2022_interface::{extension, state::Multisig};

/// One token configuration. The fields are independent axes; the default is a plain Token-2022
/// BurnMint mint with no OFT policy or redirect.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Deployment {
    pub(crate) token_program: Pubkey,
    pub(crate) lock_unlock: bool,
    /// DefaultAccountState Frozen, with Token ACL's config holding freeze and this mint's
    /// TokenManager root as its gate.
    pub(crate) acl: bool,
    /// DefaultAccountState Frozen, with the native freeze authority and no Token ACL.
    pub(crate) frozen_without_acl: bool,
    /// `pubkey_policy_hook` as the mint's transfer hook.
    pub(crate) hook: bool,
    /// PermissionedBurn, its authority on the root's PB signer.
    pub(crate) pb: bool,
    /// PermanentDelegate on the root's PD signer.
    pub(crate) permanent_delegate: bool,
    pub(crate) pausable: bool,
    /// Extensions the OFT never reads: MintCloseAuthority, InterestBearing, MetadataPointer and
    /// GroupPointer.
    pub(crate) inert: bool,
    pub(crate) transfer_fee_bps: Option<u16>,
    pub(crate) non_transferable: bool,
    /// BurnMint's mint authority as a 1-of-2 native multisig of `oft_store` and the admin.
    pub(crate) multisig_mint_authority: bool,
    /// The OFT selects the harness pubkey policy (always, on ACL or hook mints).
    pub(crate) policy: bool,
    /// The fee deposit doubles as the credit-redirect escrow.
    pub(crate) redirect: bool,
}

impl Default for Deployment {
    fn default() -> Self {
        Self {
            token_program: token2022::ID,
            lock_unlock: false,
            acl: false,
            frozen_without_acl: false,
            hook: false,
            pb: false,
            permanent_delegate: false,
            pausable: false,
            inert: false,
            transfer_fee_bps: None,
            non_transferable: false,
            multisig_mint_authority: false,
            policy: false,
            redirect: false,
        }
    }
}

impl Deployment {
    pub(crate) fn spl_token() -> Self {
        Self { token_program: mollusk_svm_programs_token::token::ID, ..Self::default() }
    }

    /// The same configuration in the other custody mode.
    pub(crate) fn custody(self, lock_unlock: bool) -> Self {
        Self { lock_unlock, ..self }
    }

    pub(crate) fn frozen_by_default(&self) -> bool {
        self.acl || self.frozen_without_acl
    }

    fn needs_token_manager(&self) -> bool {
        self.acl || self.pb || self.permanent_delegate
    }

    fn needs_policy(&self) -> bool {
        self.policy || self.acl || self.hook
    }

    /// Whether sends burn through the root's `permissioned_burn`.
    pub(crate) fn burns_through_manager(&self) -> bool {
        self.pb && !self.lock_unlock
    }

    fn mint_extensions(&self) -> Vec<ExtensionType> {
        let mut extensions = vec![];
        let mut add = |on: bool, kinds: &[ExtensionType]| {
            if on {
                extensions.extend_from_slice(kinds);
            }
        };
        add(self.pb, &[ExtensionType::PermissionedBurn]);
        add(self.frozen_by_default(), &[ExtensionType::DefaultAccountState]);
        add(self.hook, &[ExtensionType::TransferHook]);
        add(self.transfer_fee_bps.is_some(), &[ExtensionType::TransferFeeConfig]);
        add(self.permanent_delegate, &[ExtensionType::PermanentDelegate]);
        add(self.pausable, &[ExtensionType::Pausable]);
        add(self.non_transferable, &[ExtensionType::NonTransferable]);
        add(
            self.inert,
            &[
                ExtensionType::MintCloseAuthority,
                ExtensionType::InterestBearingConfig,
                ExtensionType::MetadataPointer,
                ExtensionType::GroupPointer,
            ],
        );
        extensions
    }
}

impl Harness {
    /// Deploy `d` in `docs/usage.md`'s setup order. LockUnlock escrows are funded with 1_000 so a
    /// first receive can unlock.
    pub(crate) fn deploy(d: Deployment) -> Self {
        assert!(
            d.token_program == token2022::ID || d.mint_extensions().is_empty(),
            "the SPL Token program has no extensions"
        );
        let f = OftFixture {
            context: cross_program_svm().with_context(HashMap::new()),
            payer: payer_key(),
            admin: admin_key(),
            user: user_key(),
            oft_store: oft_store_key(),
            token_mint: token_mint_key(),
            initializer: initializer_key(),
            fee_deposit: fee_deposit_key(),
            oft_escrow: oft_escrow_pda(&oft_store_key()),
            default_rate_limit: rate_limit_pda(&oft_store_key(), 0),
            peer: peer_pda(&oft_store_key(), DST_EID).0,
        };
        for wallet in [f.payer, f.admin, f.user, f.initializer] {
            f.insert(wallet, Account::new(10_000_000_000, 0, &SYSTEM_PROGRAM));
        }
        let mint = to_program_pubkey(&f.token_mint);
        let h = Self {
            token_manager: host(token_manager_address(&mint).0),
            pubkey_policy: host(pubkey_policy_address(&mint, &to_program_pubkey(&f.admin)).0),
            token_program: d.token_program,
            hook: d.hook,
            hook_program_id: host(pubkey_policy_hook::ID),
            pb: d.pb,
            transfer_fee_bps: d.transfer_fee_bps,
            compose: false,
            f,
        };

        // The issuer's token stack, which exists before any OFT does.
        let mint_authority = h.deploy_mint(&d);
        h.deploy_token_account(h.f.fee_deposit, h.f.admin, d.frozen_by_default());
        if d.needs_token_manager() {
            h.create_token_manager();
        }
        if d.needs_policy() {
            h.initialize_registry();
        }
        if d.acl {
            h.hand_freeze_to_token_acl();
        }
        if d.hook {
            h.ok(&[h.init_transfer_hook_ix()]);
        }

        // 1-2. Mint authority already names the store; `init_console_oft` creates the escrow.
        h.ok(&[h.init_console_oft_ix(&d), h.init_console_oft_info_ix()]);
        let escrow = h.token(h.f.oft_escrow);
        assert_eq!((escrow.mint, escrow.owner), (h.f.token_mint, h.f.oft_store));
        // 3. The escrow starts frozen like any new account under DefaultAccountState Frozen.
        assert_eq!(escrow.state == AccountState::Frozen, d.frozen_by_default());
        if d.acl {
            h.ok(&[h.thaw_for(h.f.oft_escrow, h.f.oft_store)]);
        } else if d.frozen_without_acl {
            h.ok(&[h.native_thaw_ix(h.f.oft_escrow)]);
        }
        // 4. Rate limits start at zero capacity; these round trips run without them.
        h.ok(&[
            h.grant_oft_role_ix(OftRole::RateLimiterManager, h.f.admin),
            set_rate_limit_global_config_ix(&h.f, h.f.admin, false, true),
            h.set_peer_ix(),
        ]);
        // 5. PermissionedBurn: the root approves the escrow's burns.
        if d.pb {
            h.ok(&[h.grant_escrow_burner_ix(), h.set_token_manager_ix()]);
        }
        // 6. Caches the receive planner reads. `init_console_oft` already cached the hook program,
        // which was set on the mint before init.
        if d.acl {
            h.ok(&[h.sync_acl_gate_ix()]);
        }
        // 7. Screening, and where blocked or frozen credits go.
        if d.needs_policy() {
            h.ok(&[set_policy(&h, Some(h.pubkey_policy))]);
        }
        if d.redirect {
            h.redirect();
        }

        if d.lock_unlock {
            h.ok(&[token::mint_to(
                &h.token_program,
                &h.f.token_mint,
                &h.f.oft_escrow,
                &mint_authority,
                &[],
                1_000,
            )
            .unwrap()]);
        }
        h
    }

    /// Creates the mint with `d`'s extensions and returns its mint authority: `oft_store` (or a
    /// multisig including it) for BurnMint, the admin for LockUnlock. The admin is the freeze
    /// authority, and the hook, pause and inert-extension authority.
    fn deploy_mint(&self, d: &Deployment) -> Pubkey {
        let f = &self.f;
        let program = &self.token_program;
        let extensions = d.mint_extensions();
        let size = ExtensionType::try_calculate_account_len::<Mint>(&extensions).unwrap();
        let mut instructions = vec![solana_system_interface::instruction::create_account(
            &f.admin,
            &f.token_mint,
            f.context.mollusk.sysvars.rent.minimum_balance(size),
            size as u64,
            program,
        )];
        let mint = &f.token_mint;
        let admin = f.admin;
        for kind in extensions {
            instructions.push(
                match kind {
                    ExtensionType::PermissionedBurn => {
                        extension::permissioned_burn::instruction::initialize(
                            program,
                            mint,
                            &signer(self.token_manager, SignerKind::PermissionedBurn),
                        )
                    },
                    ExtensionType::DefaultAccountState => {
                        extension::default_account_state::instruction::initialize_default_account_state(
                            program,
                            mint,
                            &AccountState::Frozen,
                        )
                    },
                    ExtensionType::TransferHook => extension::transfer_hook::instruction::initialize(
                        program,
                        mint,
                        Some(admin),
                        Some(self.hook_program()),
                    ),
                    ExtensionType::TransferFeeConfig => {
                        extension::transfer_fee::instruction::initialize_transfer_fee_config(
                            program,
                            mint,
                            Some(&admin),
                            Some(&admin),
                            d.transfer_fee_bps.unwrap(),
                            u64::MAX,
                        )
                    },
                    ExtensionType::PermanentDelegate => token::initialize_permanent_delegate(
                        program,
                        mint,
                        &signer(self.token_manager, SignerKind::PermanentDelegate),
                    ),
                    ExtensionType::Pausable => {
                        extension::pausable::instruction::initialize(program, mint, &admin)
                    },
                    ExtensionType::NonTransferable => {
                        token::initialize_non_transferable_mint(program, mint)
                    },
                    ExtensionType::MintCloseAuthority => {
                        token::initialize_mint_close_authority(program, mint, Some(&admin))
                    },
                    ExtensionType::InterestBearingConfig => {
                        extension::interest_bearing_mint::instruction::initialize(
                            program,
                            mint,
                            Some(admin),
                            500,
                        )
                    },
                    ExtensionType::MetadataPointer => {
                        extension::metadata_pointer::instruction::initialize(
                            program,
                            mint,
                            Some(admin),
                            None,
                        )
                    },
                    ExtensionType::GroupPointer => extension::group_pointer::instruction::initialize(
                        program,
                        mint,
                        Some(admin),
                        None,
                    ),
                    other => panic!("no initializer for {other:?}"),
                }
                .unwrap(),
            );
        }
        let mint_authority = if d.lock_unlock {
            admin
        } else if d.multisig_mint_authority {
            let multisig = Pubkey::new_unique();
            instructions.extend([
                solana_system_interface::instruction::create_account(
                    &admin,
                    &multisig,
                    f.context.mollusk.sysvars.rent.minimum_balance(Multisig::LEN),
                    Multisig::LEN as u64,
                    program,
                ),
                token::initialize_multisig2(program, &multisig, &[&f.oft_store, &admin], 1)
                    .unwrap(),
            ]);
            multisig
        } else {
            f.oft_store
        };
        instructions.push(
            token::initialize_mint2(program, mint, &mint_authority, Some(&admin), TOKEN_DECIMALS)
                .unwrap(),
        );
        self.ok(&instructions);
        mint_authority
    }

    /// A token account for `owner`, sized from the live mint and thawed by the native freeze
    /// authority when the mint freezes new accounts (before Token ACL takes freeze).
    fn deploy_token_account(&self, address: Pubkey, owner: Pubkey, thaw: bool) {
        self.open_token_account(address, owner);
        if thaw {
            self.ok(&[self.native_thaw_ix(address)]);
        }
    }

    fn native_thaw_ix(&self, account: Pubkey) -> Instruction {
        token::thaw_account(&self.token_program, &account, &self.f.token_mint, &self.f.admin, &[])
            .unwrap()
    }

    /// `init_console_oft` for this harness's initializer, admin and fee deposit, with the
    /// Endpoint's `register_oapp` accounts.
    pub(crate) fn init_console_oft_ix(&self, d: &Deployment) -> Instruction {
        let f = &self.f;
        let endpoint_id = host(endpoint::ID);
        let mut instruction = ix(
            console_oft::ID,
            console_oft::accounts::InitConsoleOFT {
                payer: to_program_pubkey(&f.payer),
                initializer: to_program_pubkey(&f.initializer),
                oft_store: to_program_pubkey(&f.oft_store),
                default_rate_limit: to_program_pubkey(&f.default_rate_limit),
                token_mint: to_program_pubkey(&f.token_mint),
                oft_escrow: to_program_pubkey(&f.oft_escrow),
                fee_deposit: to_program_pubkey(&f.fee_deposit),
                token_program: to_program_pubkey(&self.token_program),
                system_program: Default::default(),
                admin_role_member: to_program_pubkey(&role_member_pda(
                    &f.oft_store,
                    OftRole::DefaultAdmin,
                    &f.admin,
                )),
                event_authority: to_program_pubkey(&event(program_id())),
                program: console_oft::ID,
            },
            console_oft::instruction::InitConsoleOft {
                params: console_oft::instructions::InitConsoleOFTParams {
                    oft_type: if d.lock_unlock { OftType::LockUnlock } else { OftType::BurnMint },
                    admin: to_program_pubkey(&f.admin),
                    shared_decimals: TOKEN_DECIMALS,
                },
            },
        );
        let registry =
            Pubkey::find_program_address(&[b"OApp", f.oft_store.as_ref()], &endpoint_id).0;
        instruction.accounts.extend([
            AccountMeta::new_readonly(endpoint_id, false),
            AccountMeta::new(f.payer, true),
            AccountMeta::new_readonly(f.oft_store, false),
            AccountMeta::new(registry, false),
            AccountMeta::new_readonly(Pubkey::default(), false),
            AccountMeta::new_readonly(event(endpoint_id), false),
            AccountMeta::new_readonly(endpoint_id, false),
        ]);
        instruction
    }

    fn init_console_oft_info_ix(&self) -> Instruction {
        ix(
            console_oft::ID,
            console_oft::accounts::InitConsoleOftInfo {
                payer: to_program_pubkey(&self.f.payer),
                oapp_info: to_program_pubkey(&oapp_info_pda()),
                system_program: Default::default(),
            },
            console_oft::instruction::InitConsoleOftInfo {},
        )
    }

    pub(crate) fn grant_oft_role_ix(&self, role: OftRole, member: Pubkey) -> Instruction {
        let f = &self.f;
        let admin = to_program_pubkey(&f.admin);
        ix(
            console_oft::ID,
            console_oft::accounts::StdGrantRole {
                authority: admin,
                payer: admin,
                default_admin: to_program_pubkey(&f.oft_store),
                role_admin_member: self.oft_admin_role(),
                role_member: to_program_pubkey(&role_member_pda(&f.oft_store, role, &member)),
                system_program: Default::default(),
                event_authority: to_program_pubkey(&event(program_id())),
                program: console_oft::ID,
            },
            console_oft::instruction::GrantRole {
                params: rbac::types::GrantRoleParams { role, account: to_program_pubkey(&member) },
            },
        )
    }

    /// The source OFT, `[0x44; 32]` on `DST_EID`, as every message in this suite is sent from.
    fn set_peer_ix(&self) -> Instruction {
        let f = &self.f;
        let admin = to_program_pubkey(&f.admin);
        ix(
            console_oft::ID,
            console_oft::accounts::StdSetPeer {
                authority: admin,
                payer: admin,
                oapp: to_program_pubkey(&f.oft_store),
                peer: to_program_pubkey(&f.peer),
                system_program: Default::default(),
                role_member: self.oft_admin_role(),
                event_authority: to_program_pubkey(&event(program_id())),
                program: console_oft::ID,
            },
            console_oft::instruction::SetPeer {
                params: oapp::types::SetPeerParams { eid: DST_EID, peer: [0x44; 32] },
            },
        )
    }
}
