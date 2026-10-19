//! The cross-program harness: real SBF OFT, TokenManager, pubkey policy, canonical Token ACL,
//! transfer hooks, composers, Endpoint and SimpleMessageLib under Mollusk's transaction API
//! (atomic, with rollback). Endpoint verification state is seeded: this is delivery, not
//! DVN/network testing. Each `Harness` is a BurnMint Token-2022 OFT whose mint, TokenManager
//! root and pubkey policy are created through the real programs.
#![allow(dead_code)]

pub(crate) use crate::oft::helpers::{instruction as ix, *};
pub(crate) use anchor_lang::{
    AccountSerialize, AnchorDeserialize, AnchorSerialize, Discriminator, InstructionData,
    ToAccountMetas,
};
pub(crate) use console_oft::{codec, errors::OFTError, state::OFTStore};
pub(crate) use futures::executor::block_on;
pub(crate) use mollusk_svm_programs_token::token2022;
pub(crate) use mollusk_svm_result::types::{
    InstructionResult, TransactionProgramResult, TransactionResult,
};
pub(crate) use oapp::{
    common::{AccountMetaRef, AddressLocator},
    endpoint,
    lz_receive_types_v3::{
        LzReceiveTypesV3Accounts, LzReceiveTypesV3Result, LZ_RECEIVE_TYPES_VERSION,
    },
    types::LzReceiveParams,
};
pub(crate) use pubkey_policy_interface::{
    pubkey_policy_address, subject_address, PubkeyPolicyMode,
};
pub(crate) use solana_account::Account;
pub(crate) use solana_instruction::{error::InstructionError, AccountMeta, Instruction};
pub(crate) use solana_program_error::ProgramError;
pub(crate) use solana_pubkey::Pubkey;
pub(crate) use spl_token_2022_interface::{
    extension::{ExtensionType, StateWithExtensions},
    instruction as token,
    state::{Account as TokenAccount, AccountState, Mint},
};
pub(crate) use std::{
    collections::{HashMap, HashSet},
    future::ready,
    path::PathBuf,
};
pub(crate) use token_acl_client::{accounts::MintConfig, instructions as acl};
pub(crate) use token_manager::RoleType;
pub(crate) use token_manager_interface::{signer_address, token_manager_address, SignerKind};

pub(crate) fn event(program: Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], &program).0
}
pub(crate) fn role(policy: Pubkey, kind: RoleType, member: Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[rbac::ROLE_MEMBER_SEED, policy.as_ref(), &[kind as u8], member.as_ref()],
        &host(token_manager::ID),
    )
    .0
}

pub(crate) fn policy_role(
    pubkey_policy: Pubkey,
    kind: pubkey_policy::RoleType,
    member: Pubkey,
) -> Pubkey {
    Pubkey::find_program_address(
        &[rbac::ROLE_MEMBER_SEED, pubkey_policy.as_ref(), &[kind as u8], member.as_ref()],
        &host(pubkey_policy::ID),
    )
    .0
}

pub(crate) fn signer(policy: Pubkey, kind: SignerKind) -> Pubkey {
    host(signer_address(&to_program_pubkey(&policy), kind).0)
}

pub(crate) fn simple_library_id() -> Pubkey {
    "6GsmxMTHAAiFKfemuM4zBjumTjNSX5CAiw4xSSXM2Toy".parse().unwrap()
}

/// Mollusk with every program the cross-program suite executes: the OFT, both token programs and
/// the ATA program, TokenManager, pubkey policy and hook, Token ACL, Endpoint, SimpleMessageLib
/// and the test-only hook and composers.
pub(crate) fn cross_program_svm() -> mollusk_svm::Mollusk {
    let mut svm = mollusk();
    mollusk_svm_programs_token::token::add_program(&mut svm);
    svm.compute_budget.heap_size = 256 * 1024; // Executor's configured heap budget.
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    for (id, binary) in [
        (token2022::ID, "target/test-deploy/token_2022_fixture"),
        (simple_library_id(), "target/programs/simple_messagelib"),
        (host(token_manager::ID), "target/test-deploy/token_manager"),
        (host(pubkey_policy_hook::ID), "target/test-deploy/pubkey_policy_hook"),
        (host(pubkey_policy::ID), "target/test-deploy/pubkey_policy"),
        (host(transfer_hook_fixture::ID), "target/test-deploy/transfer_hook_fixture"),
        (host(forwarding_composer::ID), "target/test-deploy/forwarding_composer"),
        (host(multihop_composer::ID), "target/test-deploy/multihop_composer"),
        (host(endpoint::ID), "target/programs/endpoint"),
        (
            Pubkey::new_from_array(token_acl_interface::TOKEN_ACL_ID.to_bytes()),
            "target/test-deploy/token_acl_fixture",
        ),
    ] {
        svm.add_program(&id, root.join(binary).to_str().unwrap());
    }
    svm
}

pub(crate) struct Harness {
    pub(crate) f: OftFixture,
    /// The mint's TokenManager root: burn approver and ACL signer namespace.
    pub(crate) token_manager: Pubkey,
    /// The admin-created pubkey policy the OFT, ACL gate and hook bind.
    pub(crate) pubkey_policy: Pubkey,
    pub(crate) token_program: Pubkey,
    pub(crate) hook: bool,
    pub(crate) hook_program_id: Pubkey,
    pub(crate) pb: bool,
    /// Basis points of a Token-2022 TransferFee extension, initialized live at the current epoch.
    pub(crate) transfer_fee_bps: Option<u16>,
    pub(crate) compose: bool,
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum HookFixtureKind {
    Absent,
    Empty,
    DestinationSeeds,
}

impl Harness {
    /// Seed only protocol configuration, not token or PB outcomes. Both Endpoint
    /// and SimpleMessageLib execute their packaged upstream SBF implementations.
    pub(crate) fn send_endpoint_accounts(&self, native_fee: u64) -> Vec<AccountMeta> {
        let endpoint_id = host(endpoint::ID);
        let lib_id = simple_library_id();
        let (lib, lib_bump) = Pubkey::find_program_address(&[b"MessageLib"], &lib_id);
        let (info, bump) =
            Pubkey::find_program_address(&[b"MessageLib", lib.as_ref()], &endpoint_id);
        self.seed(
            info,
            endpoint::accounts::MessageLibInfo {
                message_lib_type: endpoint::types::MessageLibType::Send,
                bump,
                message_lib_bump: lib_bump,
            },
        );
        let (config, bump) = Pubkey::find_program_address(
            &[b"SendLibraryConfig", self.f.oft_store.as_ref(), &DST_EID.to_be_bytes()],
            &endpoint_id,
        );
        self.seed(
            config,
            endpoint::accounts::SendLibraryConfig { message_lib: to_program_pubkey(&lib), bump },
        );
        let (default, bump) = Pubkey::find_program_address(
            &[b"SendLibraryConfig", &DST_EID.to_be_bytes()],
            &endpoint_id,
        );
        self.seed(
            default,
            endpoint::accounts::SendLibraryConfig { message_lib: to_program_pubkey(&lib), bump },
        );
        let settings = Pubkey::find_program_address(&[b"Endpoint"], &endpoint_id).0;
        let nonce = Pubkey::find_program_address(
            &[b"Nonce", self.f.oft_store.as_ref(), &DST_EID.to_be_bytes(), &[0x44; 32]],
            &endpoint_id,
        )
        .0;
        // SimpleMessageLib's immutable/mutable fields in its upstream account
        // layout (apps/project-types/deploy-wire-protocol-app/contracts/solana/programs/simple-messagelib/src/state/message_lib.rs).
        let mut data = vec![141, 191, 244, 48, 52, 174, 199, 209]; // account:MessageLib
        data.extend(1u32.to_le_bytes());
        data.extend(info.to_bytes());
        data.extend(endpoint_id.to_bytes());
        data.push(lib_bump);
        data.extend(self.f.admin.to_bytes());
        data.extend(native_fee.to_le_bytes());
        data.extend(0u64.to_le_bytes());
        data.extend(self.f.admin.to_bytes());
        self.f
            .context
            .account_store
            .borrow_mut()
            .insert(lib, Account { data, ..Account::new(10_000_000, 0, &lib_id) });
        vec![
            AccountMeta::new_readonly(endpoint_id, false),
            AccountMeta::new_readonly(self.f.oft_store, false),
            AccountMeta::new_readonly(lib_id, false),
            AccountMeta::new_readonly(config, false),
            AccountMeta::new_readonly(default, false),
            AccountMeta::new_readonly(info, false),
            AccountMeta::new_readonly(settings, false),
            AccountMeta::new(nonce, false),
            AccountMeta::new_readonly(event(endpoint_id), false),
            AccountMeta::new_readonly(endpoint_id, false),
            AccountMeta::new(lib, false),
            AccountMeta::new(self.f.payer, true),
            AccountMeta::new_readonly(Default::default(), false),
        ]
    }

    pub(crate) fn send(
        &self,
        with_manager: bool,
        endpoint_accounts: &[AccountMeta],
    ) -> Instruction {
        self.send_from(self.ata(), with_manager, endpoint_accounts)
    }

    pub(crate) fn send_from(
        &self,
        source: Pubkey,
        with_manager: bool,
        endpoint_accounts: &[AccountMeta],
    ) -> Instruction {
        let f = &self.f;
        let store: OFTStore = read_account(&f.context, &f.oft_store);
        let enforced = Pubkey::find_program_address(
            console_oft::EnforcedOptions::seeds(&to_program_pubkey(&f.oft_store), DST_EID, 1),
            &program_id(),
        )
        .0;
        let mut send = ix(
            console_oft::ID,
            console_oft::accounts::Send {
                signer: to_program_pubkey(&self.recipient()),
                oft_store: to_program_pubkey(&f.oft_store),
                peer: to_program_pubkey(&f.peer),
                enforced_options: to_program_pubkey(&enforced),
                pause_config: to_program_pubkey(&pause_config_pda(&f.oft_store, DST_EID.into())),
                fee_config: to_program_pubkey(&fee_config_pda(&f.oft_store, DST_EID.into())),
                default_rate_limit: to_program_pubkey(&f.default_rate_limit),
                rate_limit: to_program_pubkey(&rate_limit_pda(&f.oft_store, DST_EID.into())),
                address_exemption: to_program_pubkey(&rate_limit_address_exemption_pda(
                    &f.oft_store,
                    &self.recipient(),
                )),
                token_source: to_program_pubkey(&source),
                oft_escrow: to_program_pubkey(&f.oft_escrow),
                fee_deposit: Some(to_program_pubkey(&f.fee_deposit)),
                token_mint: to_program_pubkey(&f.token_mint),
                token_program: to_program_pubkey(&self.token_program),
                burn_policy: with_manager.then(|| to_program_pubkey(&self.token_manager)),
                burn_role: with_manager.then(|| {
                    to_program_pubkey(&role(self.token_manager, RoleType::Burner, f.oft_escrow))
                }),
                burn_manager: with_manager.then_some(token_manager::ID),
                burn_signer: with_manager.then(|| {
                    to_program_pubkey(&signer(self.token_manager, SignerKind::PermissionedBurn))
                }),
                event_authority: to_program_pubkey(&event(program_id())),
                program: console_oft::ID,
            },
            console_oft::instruction::Send {
                params: ::oft::types::SendParams {
                    dst_eid: DST_EID,
                    to: [0x55; 32],
                    amount_ld: 100,
                    min_amount_ld: 0,
                    extra_options: vec![],
                    compose_msg: None,
                    native_fee: 0,
                    lz_token_fee: 0,
                },
            },
        );
        if self.hook {
            let fee = 100 * u64::from(store.default_fee_bps) / 10_000;
            let mut transfers = vec![(source, f.oft_escrow, self.recipient(), 100)];
            if fee > 0 {
                transfers.push((f.oft_escrow, f.fee_deposit, f.oft_store, fee));
            }
            for (from, to, authority, amount) in transfers {
                if self.account(self.hook_manifest()).data.is_empty() {
                    send.accounts.extend([
                        AccountMeta::new_readonly(self.hook_program(), false),
                        AccountMeta::new_readonly(self.hook_manifest(), false),
                    ]);
                    continue;
                }
                let transfer = block_on(
                    spl_token_2022::offchain::create_transfer_checked_instruction_with_extra_metas(
                        &token2022::ID,
                        &from,
                        &f.token_mint,
                        &to,
                        &authority,
                        &[],
                        amount,
                        TOKEN_DECIMALS,
                        |key| {
                            ready(Ok(self
                                .f
                                .context
                                .account_store
                                .borrow()
                                .get(&key)
                                .map(|a| a.data.clone())))
                        },
                    ),
                )
                .unwrap();
                // OFT's existing prefix is [hook, EAML, resolved extras], whereas
                // the SPL off-chain helper appends [resolved extras, hook, EAML].
                let end = transfer.accounts.len();
                send.accounts.extend_from_slice(&transfer.accounts[end - 2..]);
                send.accounts.extend_from_slice(&transfer.accounts[4..end - 2]);
            }
        }
        send.accounts.extend_from_slice(endpoint_accounts);
        send
    }

    pub(crate) fn new(acl_enabled: bool, hook: bool) -> Self {
        Self::with_pb(acl_enabled, hook, false)
    }

    pub(crate) fn with_pb(acl_enabled: bool, hook: bool, pb: bool) -> Self {
        Self::with_token_program(token2022::ID, acl_enabled, hook, pb)
    }

    pub(crate) fn with_transfer_fee(bps: u16) -> Self {
        Self::build(token2022::ID, false, false, false, Some(bps))
    }

    pub(crate) fn with_token_program(
        token_program: Pubkey,
        acl_enabled: bool,
        hook: bool,
        pb: bool,
    ) -> Self {
        Self::build(token_program, acl_enabled, hook, pb, None)
    }

    fn build(
        token_program: Pubkey,
        acl_enabled: bool,
        hook: bool,
        pb: bool,
        transfer_fee_bps: Option<u16>,
    ) -> Self {
        assert!(token_program == token2022::ID || (!acl_enabled && !hook && !pb));
        let f = build_fixture(cross_program_svm().with_context(HashMap::new()));
        let token_manager = host(token_manager_address(&to_program_pubkey(&f.token_mint)).0);
        let pubkey_policy = host(
            pubkey_policy_address(&to_program_pubkey(&f.token_mint), &to_program_pubkey(&f.admin))
                .0,
        );
        let h = Self {
            f,
            token_manager,
            pubkey_policy,
            token_program,
            hook,
            hook_program_id: host(pubkey_policy_hook::ID),
            pb,
            transfer_fee_bps,
            compose: false,
        };
        for wallet in [h.f.admin, h.f.payer] {
            h.f.context.account_store.borrow_mut().get_mut(&wallet).unwrap().lamports =
                10_000_000_000;
        }
        let mut store: OFTStore = read_account(&h.f.context, &h.f.oft_store);
        store.oft_type = ::oft::types::OftType::BurnMint;
        // The SPL variant swaps the mint's program; the cached field must agree or account
        // discovery derives the wrong ATA and mint constraints reject the store's own value.
        store.token_program = to_program_pubkey(&token_program);
        // Rate limiting is off unless a test turns it on: the fixture limiter has zero capacity.
        store.is_globally_disabled = true;
        store
            .try_serialize(
                &mut h
                    .f
                    .context
                    .account_store
                    .borrow_mut()
                    .get_mut(&h.f.oft_store)
                    .unwrap()
                    .data
                    .as_mut_slice(),
            )
            .unwrap();
        h.initialize_mint(acl_enabled);
        // lz_receive_types_info reports the hook from this cached field, so account discovery
        // silently omits the hook groups until it is synced against the live mint.
        h.ok(&[h.sync_transfer_hook_ix()]);
        h.create_token_manager();
        h.initialize_registry();
        h.ok(&[h.grant_escrow_burner_ix(), h.set_token_manager_ix()]);
        if acl_enabled {
            h.initialize_acl();
        }
        // The hook and the OFT bind the same policy; nothing enforces that, the setup keeps it.
        if hook {
            h.ok(&[h.init_transfer_hook_ix()]);
        }
        h.ok(&[set_policy(&h, Some(h.pubkey_policy))]);
        h
    }

    /// Anyone refreshes the OFT's cached transfer-hook program from the live mint.
    pub(crate) fn sync_transfer_hook_ix(&self) -> Instruction {
        ix(
            console_oft::ID,
            console_oft::accounts::SyncTransferHookProgram {
                oft_store: to_program_pubkey(&self.f.oft_store),
                token_mint: to_program_pubkey(&self.f.token_mint),
                event_authority: to_program_pubkey(&event(program_id())),
                program: console_oft::ID,
            },
            console_oft::instruction::SyncTransferHookProgram {},
        )
    }

    /// The mint's TokenManager root, created by its freeze admin, who also becomes DefaultAdmin.
    pub(crate) fn create_token_manager(&self) {
        let a = to_program_pubkey(&self.f.admin);
        let p = to_program_pubkey(&self.token_manager);
        let mut init = ix(
            token_manager::ID,
            token_manager::accounts::InitTokenManager {
                payer: a,
                authority: a,
                mint: to_program_pubkey(&self.f.token_mint),
                mint_config: None,
                token_manager: p,
                system_program: Default::default(),
                event_authority: to_program_pubkey(&event(host(token_manager::ID))),
                program: token_manager::ID,
            },
            token_manager::instruction::InitTokenManager {
                params: token_manager::InitTokenManagerParams { pending_admin: a },
            },
        );
        init.accounts
            .iter_mut()
            .filter(|m| m.pubkey == self.f.admin)
            .for_each(|m| m.is_signer = true);
        self.ok(&[
            init,
            ix(
                token_manager::ID,
                token_manager::accounts::AcceptTokenManagerAdmin {
                    payer: a,
                    admin: a,
                    token_manager: p,
                    system_program: Default::default(),
                    admin_role_member: to_program_pubkey(&role(
                        self.token_manager,
                        RoleType::DefaultAdmin,
                        self.f.admin,
                    )),
                    event_authority: to_program_pubkey(&event(host(token_manager::ID))),
                    program: token_manager::ID,
                },
                token_manager::instruction::AcceptTokenManagerAdmin {},
            ),
        ]);
    }

    /// The root grants Burner to `oft_escrow`, the address PermissionedBurn sends approve as.
    pub(crate) fn grant_escrow_burner_ix(&self) -> Instruction {
        let a = to_program_pubkey(&self.f.admin);
        ix(
            token_manager::ID,
            token_manager::accounts::StdGrantRole {
                authority: a,
                payer: a,
                default_admin: to_program_pubkey(&self.token_manager),
                role_admin_member: to_program_pubkey(&role(
                    self.token_manager,
                    RoleType::DefaultAdmin,
                    self.f.admin,
                )),
                role_member: to_program_pubkey(&role(
                    self.token_manager,
                    RoleType::Burner,
                    self.f.oft_escrow,
                )),
                system_program: Default::default(),
                event_authority: to_program_pubkey(&event(host(token_manager::ID))),
                program: token_manager::ID,
            },
            token_manager::instruction::GrantRole {
                params: rbac::types::GrantRoleParams {
                    role: RoleType::Burner,
                    account: to_program_pubkey(&self.f.oft_escrow),
                },
            },
        )
    }

    /// The OFT admin selects the mint's root for PermissionedBurn sends.
    pub(crate) fn set_token_manager_ix(&self) -> Instruction {
        ix(
            console_oft::ID,
            console_oft::accounts::SetTokenManager {
                authority: to_program_pubkey(&self.f.admin),
                oft_store: to_program_pubkey(&self.f.oft_store),
                token_manager: Some(to_program_pubkey(&self.token_manager)),
                role_member: self.oft_admin_role(),
                event_authority: to_program_pubkey(&event(program_id())),
                program: console_oft::ID,
            },
            console_oft::instruction::SetTokenManager {},
        )
    }

    /// The hook-update authority (the admin) binds the harness policy into the hook's manifest.
    pub(crate) fn init_transfer_hook_ix(&self) -> Instruction {
        let a = to_program_pubkey(&self.f.admin);
        ix(
            pubkey_policy_hook::ID,
            pubkey_policy_hook::accounts::InitTransferHook {
                payer: a,
                authority: a,
                mint: to_program_pubkey(&self.f.token_mint),
                pubkey_policy: to_program_pubkey(&self.pubkey_policy),
                extra_account_metas: to_program_pubkey(&self.hook_manifest()),
                system_program: Default::default(),
                event_authority: to_program_pubkey(&event(host(pubkey_policy_hook::ID))),
                program: pubkey_policy_hook::ID,
            },
            pubkey_policy_hook::instruction::InitTransferHook {},
        )
    }

    pub(crate) fn run(&self, instructions: &[Instruction]) -> TransactionResult {
        let mut keys = HashSet::new();
        let input = instructions
            .iter()
            .flat_map(|i| &i.accounts)
            .filter(|m| keys.insert(m.pubkey))
            .map(|m| (m.pubkey, self.account(m.pubkey)))
            .collect::<Vec<_>>();
        let result = self.f.context.mollusk.process_transaction_instructions(instructions, &input, None);
        if result.program_result.is_ok() {
            self.f
                .context
                .account_store
                .borrow_mut()
                .extend(result.resulting_accounts.iter().cloned());
        } else {
            assert_eq!(result.resulting_accounts, input, "failed transaction must roll back");
        }
        result
    }
    pub(crate) fn ok(&self, instructions: &[Instruction]) -> TransactionResult {
        let result = self.run(instructions);
        assert!(result.program_result.is_ok(), "{:?}", result.program_result);
        if instructions.iter().any(|ix| {
            ix.program_id == program_id()
                && ix.data.starts_with(console_oft::instruction::LzReceive::DISCRIMINATOR)
        }) {
            let event = result
                .inner_instructions
                .iter()
                .flatten()
                .find(|inner| {
                    inner.instruction.data.get(8..16)
                        == Some(::oft::events::OFTReceived::DISCRIMINATOR)
                })
                .expect("OFTReceived event");
            assert_event(
                &event.instruction.data,
                ::oft::events::OFTReceived {
                    oft_store: to_program_pubkey(&self.f.oft_store),
                    guid: self.params().guid,
                    src_eid: DST_EID,
                    to: to_program_pubkey(&self.recipient()),
                    amount_received_ld: if result.inner_instructions.iter().flatten().any(|inner| {
                        inner.instruction.data.get(8..16)
                            == Some(console_oft::events::CreditRedirected::DISCRIMINATOR)
                    }) {
                        0
                    } else {
                        1_000
                    },
                },
            );
        }
        result
    }
    pub(crate) fn account(&self, key: Pubkey) -> Account {
        self.f.context.account_store.borrow().get(&key).cloned().unwrap_or_default()
    }
    pub(crate) fn token(&self, key: Pubkey) -> TokenAccount {
        StateWithExtensions::<TokenAccount>::unpack(&self.account(key).data)
            .unwrap()
            .base
    }

    pub(crate) fn assert_inline_thaw(&self, result: &TransactionResult, expected: bool) {
        let keys = result.message.as_ref().unwrap().account_keys();
        let heights = |program| {
            result
                .inner_instructions
                .iter()
                .flatten()
                .filter(|inner| keys[usize::from(inner.instruction.program_id_index)] == program)
                .map(|inner| inner.stack_height)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            heights(host(token_acl_interface::TOKEN_ACL_ID)),
            if expected { vec![Some(2)] } else { vec![] }
        );
        // The manager is only entered by native ACL's callback, never as a thaw wrapper.
        assert_eq!(heights(host(token_manager::ID)), if expected { vec![Some(3)] } else { vec![] });
        let thaws = result
            .inner_instructions
            .iter()
            .flatten()
            .filter(|inner| {
                keys[usize::from(inner.instruction.program_id_index)] == self.token_program
                    && inner.instruction.data == vec![11] // SPL ThawAccount
            })
            .collect::<Vec<_>>();
        assert_eq!(thaws.len(), usize::from(expected));
        if expected {
            assert_eq!(thaws[0].stack_height, Some(3));
        }
    }

    /// Assert actual invocation shape, not just balances: ordinary burns bypass
    /// the manager; PB adds exactly one manager invocation before the native burn.
    pub(crate) fn assert_burn_path(&self, result: &TransactionResult, permissioned: bool) {
        let keys = result.message.as_ref().unwrap().account_keys();
        let inner = result.inner_instructions.iter().flatten().collect::<Vec<_>>();
        assert_eq!(
            inner
                .iter()
                .filter(|ix| keys[usize::from(ix.instruction.program_id_index)]
                    == host(token_manager::ID))
                .count(),
            usize::from(permissioned),
        );
        let native = if permissioned {
            spl_token_2022_interface::extension::permissioned_burn::instruction::burn_checked(
                &self.token_program,
                &self.f.oft_escrow,
                &self.f.token_mint,
                &self.token_manager,
                &self.f.oft_store,
                &[],
                100,
                TOKEN_DECIMALS,
            )
        } else {
            token::burn(
                &self.token_program,
                &self.f.oft_escrow,
                &self.f.token_mint,
                &self.f.oft_store,
                &[],
                100,
            )
        }
        .unwrap();
        let burns = inner
            .iter()
            .filter(|ix| {
                keys[usize::from(ix.instruction.program_id_index)] == self.token_program
                    && ix.instruction.data == native.data
            })
            .collect::<Vec<_>>();
        assert_eq!(burns.len(), 1);
        assert_eq!(burns[0].stack_height, Some(if permissioned { 3 } else { 2 }));
    }
    pub(crate) fn recipient(&self) -> Pubkey {
        self.f.user
    }
    pub(crate) fn ata(&self) -> Pubkey {
        spl_associated_token_account_interface::address::get_associated_token_address_with_program_id(&self.recipient(), &self.f.token_mint, &self.token_program)
    }
    pub(crate) fn create_ata(&self) -> Instruction {
        spl_associated_token_account_interface::instruction::create_associated_token_account_idempotent(&self.f.payer, &self.recipient(), &self.f.token_mint, &self.token_program)
    }
    pub(crate) fn config(&self) -> Pubkey {
        Pubkey::new_from_array(MintConfig::find_pda(&self.f.token_mint).0.to_bytes())
    }
    pub(crate) fn hook_program(&self) -> Pubkey {
        self.hook_program_id
    }
    pub(crate) fn hook_manifest(&self) -> Pubkey {
        Pubkey::find_program_address(
            &[b"extra-account-metas", self.f.token_mint.as_ref()],
            &self.hook_program(),
        )
        .0
    }

    pub(crate) fn use_hook_fixture(&mut self, kind: HookFixtureKind) {
        use spl_tlv_account_resolution::{
            account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
        };
        use spl_transfer_hook_interface::instruction::ExecuteInstruction;
        self.ok(&[
            spl_token_2022_interface::extension::transfer_hook::instruction::update(
                &self.token_program,
                &self.f.token_mint,
                &self.f.admin,
                &[],
                Some(host(transfer_hook_fixture::ID)),
            )
            .unwrap(),
            ix(
                console_oft::ID,
                console_oft::accounts::SyncTransferHookProgram {
                    oft_store: to_program_pubkey(&self.f.oft_store),
                    token_mint: to_program_pubkey(&self.f.token_mint),
                    event_authority: to_program_pubkey(&event(program_id())),
                    program: console_oft::ID,
                },
                console_oft::instruction::SyncTransferHookProgram {},
            ),
        ]);
        self.hook_program_id = host(transfer_hook_fixture::ID);
        let mut account = Account::default();
        if !matches!(kind, HookFixtureKind::Absent) {
            let metas = if matches!(kind, HookFixtureKind::DestinationSeeds) {
                vec![
                    ExtraAccountMeta::new_with_seeds(
                        &[Seed::AccountKey { index: 2 }],
                        false,
                        false,
                    )
                    .unwrap(),
                    ExtraAccountMeta::new_with_seeds(
                        &[Seed::AccountData { account_index: 2, data_index: 32, length: 32 }],
                        false,
                        false,
                    )
                    .unwrap(),
                ]
            } else {
                vec![]
            };
            account = Account::new(
                10_000_000,
                ExtraAccountMetaList::size_of(metas.len()).unwrap(),
                &host(transfer_hook_fixture::ID),
            );
            ExtraAccountMetaList::init::<ExecuteInstruction>(&mut account.data, &metas).unwrap();
        }
        self.f.context.account_store.borrow_mut().insert(self.hook_manifest(), account);
    }

    pub(crate) fn initialize_mint(&self, acl_enabled: bool) {
        let f = &self.f;
        // Replace the base fixture's mint with one initialized through the real token program.
        f.context.account_store.borrow_mut().insert(f.token_mint, Account::default());
        let mut extensions = vec![];
        if self.pb {
            extensions.push(ExtensionType::PermissionedBurn);
        }
        if acl_enabled {
            extensions.push(ExtensionType::DefaultAccountState);
        }
        if self.hook {
            extensions.push(ExtensionType::TransferHook);
        }
        if self.transfer_fee_bps.is_some() {
            extensions.push(ExtensionType::TransferFeeConfig);
        }
        let size = ExtensionType::try_calculate_account_len::<Mint>(&extensions).unwrap();
        let mut instructions = vec![solana_system_interface::instruction::create_account(
            &f.admin,
            &f.token_mint,
            f.context.mollusk.sysvars.rent.minimum_balance(size),
            size as u64,
            &self.token_program,
        )];
        if self.pb {
            instructions.push(
                spl_token_2022_interface::extension::permissioned_burn::instruction::initialize(
                    &token2022::ID,
                    &f.token_mint,
                    &signer(self.token_manager, SignerKind::PermissionedBurn),
                )
                .unwrap(),
            );
        }
        if acl_enabled {
            instructions.push(spl_token_2022_interface::extension::default_account_state::instruction::initialize_default_account_state(&token2022::ID, &f.token_mint, &AccountState::Frozen).unwrap());
        }
        if self.hook {
            instructions.push(
                spl_token_2022_interface::extension::transfer_hook::instruction::initialize(
                    &token2022::ID,
                    &f.token_mint,
                    Some(f.admin),
                    Some(host(pubkey_policy_hook::ID)),
                )
                .unwrap(),
            );
        }
        if let Some(bps) = self.transfer_fee_bps {
            instructions.push(
                spl_token_2022_interface::extension::transfer_fee::instruction::initialize_transfer_fee_config(
                    &token2022::ID,
                    &f.token_mint,
                    Some(&f.admin),
                    Some(&f.admin),
                    bps,
                    u64::MAX,
                )
                .unwrap(),
            );
        }
        instructions.push(
            token::initialize_mint2(
                &self.token_program,
                &f.token_mint,
                &f.oft_store,
                Some(&f.admin),
                TOKEN_DECIMALS,
            )
            .unwrap(),
        );
        self.ok(&instructions);
        // The OFT escrow already exists in the fixture. Allocate the extensions this mint
        // requires, then initialize it using SPL. It must be thawed before ACL takes control.
        let mint = self.account(f.token_mint);
        let size = spl_token_2022_interface::extension::account_len::try_calculate_account_len_from_mint_data(&mint.data, &[]).unwrap();
        for (address, owner) in [(f.oft_escrow, f.oft_store), (f.fee_deposit, f.admin)] {
            f.context
                .account_store
                .borrow_mut()
                .insert(address, Account::new(10_000_000, size, &self.token_program));
            self.ok(&[token::initialize_account3(
                &self.token_program,
                &address,
                &f.token_mint,
                &owner,
            )
            .unwrap()]);
            if acl_enabled {
                self.ok(&[token::thaw_account(
                    &token2022::ID,
                    &address,
                    &f.token_mint,
                    &f.admin,
                    &[],
                )
                .unwrap()]);
            }
        }
    }

    pub(crate) fn initialize_acl(&self) {
        self.hand_freeze_to_token_acl();
        self.ok(&[self.sync_acl_gate_ix()]);
    }

    /// Token ACL's config takes the native freeze authority with this root as its gate, the root's
    /// Acl signer becomes its logical admin, and the gate binds the harness policy with
    /// permissionless freeze and thaw on. Run by the issuer before or after the OFT exists; the
    /// OFT's cached gate needs `sync_acl_gate_ix` once it does.
    pub(crate) fn hand_freeze_to_token_acl(&self) {
        let f = &self.f;
        let manager = host(token_manager::ID);
        self.ok(&[acl::CreateConfigBuilder::new()
            .payer(f.admin)
            .authority(f.admin)
            .mint(f.token_mint)
            .mint_config(self.config())
            .gating_program(manager)
            .instruction()]);
        self.ok(&[acl::SetAuthorityBuilder::new()
            .authority(f.admin)
            .mint_config(self.config())
            .new_authority(signer(self.token_manager, SignerKind::Acl))
            .instruction()]);
        self.ok(&[
            self.init_acl_ix(self.pubkey_policy),
            ix(
                token_manager::ID,
                token_manager::accounts::ManageAcl {
                    authority: to_program_pubkey(&f.admin),
                    token_manager: to_program_pubkey(&self.token_manager),
                    acl_signer: to_program_pubkey(&signer(self.token_manager, SignerKind::Acl)),
                    mint_config: to_program_pubkey(&self.config()),
                    acl_program: to_program_pubkey(&token_acl_interface::TOKEN_ACL_ID),
                    role_member: to_program_pubkey(&role(
                        self.token_manager,
                        RoleType::DefaultAdmin,
                        f.admin,
                    )),
                    event_authority: to_program_pubkey(&event(manager)),
                    program: token_manager::ID,
                },
                token_manager::instruction::SetAclPermissions {
                    params: token_manager::AclPermissions {
                        freeze_enabled: true,
                        thaw_enabled: true,
                    },
                },
            ),
        ]);
    }

    /// Anyone refreshes the OFT's cached gate from the MintConfig, as after any gate change.
    pub(crate) fn sync_acl_gate_ix(&self) -> Instruction {
        ix(
            console_oft::ID,
            console_oft::accounts::SyncAclGatingProgram {
                oft_store: to_program_pubkey(&self.f.oft_store),
                mint_config: to_program_pubkey(&self.config()),
                event_authority: to_program_pubkey(&event(program_id())),
                program: console_oft::ID,
            },
            console_oft::instruction::SyncAclGatingProgram {},
        )
    }

    /// The admin creates the mint's Blacklist policy and holds both membership roles on it.
    /// TM DefaultAdmin (re)writes both gate manifests to bind `pubkey_policy`.
    pub(crate) fn init_acl_ix(&self, pubkey_policy: Pubkey) -> Instruction {
        let f = &self.f;
        let manager = host(token_manager::ID);
        ix(
            token_manager::ID,
            token_manager::accounts::InitAcl {
                payer: to_program_pubkey(&f.admin),
                authority: to_program_pubkey(&f.admin),
                mint: to_program_pubkey(&f.token_mint),
                token_manager: to_program_pubkey(&self.token_manager),
                pubkey_policy: to_program_pubkey(&pubkey_policy),
                thaw_metas: to_program_pubkey(
                    &token_acl_interface::get_thaw_extra_account_metas_address(
                        &f.token_mint,
                        &manager,
                    ),
                ),
                freeze_metas: to_program_pubkey(
                    &token_acl_interface::get_freeze_extra_account_metas_address(
                        &f.token_mint,
                        &manager,
                    ),
                ),
                system_program: Default::default(),
                role_member: to_program_pubkey(&role(
                    self.token_manager,
                    RoleType::DefaultAdmin,
                    f.admin,
                )),
                event_authority: to_program_pubkey(&event(manager)),
                program: token_manager::ID,
            },
            token_manager::instruction::InitAcl {},
        )
    }

    pub(crate) fn initialize_registry(&self) {
        let a = to_program_pubkey(&self.f.admin);
        let pubkey_policy = to_program_pubkey(&self.pubkey_policy);
        let event_authority = to_program_pubkey(&event(host(pubkey_policy::ID)));
        let mut instructions = vec![ix(
            pubkey_policy::ID,
            pubkey_policy::accounts::InitPubkeyPolicy {
                payer: a,
                initializer: a,
                policy: pubkey_policy,
                system_program: Default::default(),
                admin_role_member: to_program_pubkey(&policy_role(
                    self.pubkey_policy,
                    pubkey_policy::RoleType::DefaultAdmin,
                    self.f.admin,
                )),
                event_authority,
                program: pubkey_policy::ID,
            },
            pubkey_policy::instruction::InitPubkeyPolicy {
                params: pubkey_policy::InitPubkeyPolicyParams {
                    mint: to_program_pubkey(&self.f.token_mint),
                    admin: a,
                    mode: PubkeyPolicyMode::Blacklist,
                },
            },
        )];
        for kind in [pubkey_policy::RoleType::Blacklister, pubkey_policy::RoleType::Whitelister] {
            instructions.push(ix(
                pubkey_policy::ID,
                pubkey_policy::accounts::StdGrantRole {
                    authority: a,
                    payer: a,
                    default_admin: pubkey_policy,
                    role_admin_member: to_program_pubkey(&policy_role(
                        self.pubkey_policy,
                        pubkey_policy::RoleType::DefaultAdmin,
                        self.f.admin,
                    )),
                    role_member: to_program_pubkey(&policy_role(
                        self.pubkey_policy,
                        kind,
                        self.f.admin,
                    )),
                    system_program: Default::default(),
                    event_authority,
                    program: pubkey_policy::ID,
                },
                pubkey_policy::instruction::GrantRole {
                    params: rbac::types::GrantRoleParams { role: kind, account: a },
                },
            ));
        }
        self.ok(&instructions);
    }

    pub(crate) fn set_mode(&self, mode: PubkeyPolicyMode) -> Instruction {
        ix(
            pubkey_policy::ID,
            pubkey_policy::accounts::SetMode {
                authority: to_program_pubkey(&self.f.admin),
                policy: to_program_pubkey(&self.pubkey_policy),
                role_member: to_program_pubkey(&policy_role(
                    self.pubkey_policy,
                    pubkey_policy::RoleType::DefaultAdmin,
                    self.f.admin,
                )),
                event_authority: to_program_pubkey(&event(host(pubkey_policy::ID))),
                program: pubkey_policy::ID,
            },
            pubkey_policy::instruction::SetMode { mode },
        )
    }

    pub(crate) fn membership(&self, subject: Pubkey, whitelist: bool, value: bool) -> Instruction {
        let role_kind = if whitelist {
            pubkey_policy::RoleType::Whitelister
        } else {
            pubkey_policy::RoleType::Blacklister
        };
        // Both setter contexts intentionally have the same account shape, distinct RBAC roles.
        let accounts = pubkey_policy::accounts::SetBlacklisted {
            payer: to_program_pubkey(&self.f.admin),
            authority: to_program_pubkey(&self.f.admin),
            policy: to_program_pubkey(&self.pubkey_policy),
            record: subject_address(
                &to_program_pubkey(&self.pubkey_policy),
                &to_program_pubkey(&subject),
            )
            .0,
            system_program: Default::default(),
            role_member: to_program_pubkey(&policy_role(
                self.pubkey_policy,
                role_kind,
                self.f.admin,
            )),
            event_authority: to_program_pubkey(&event(host(pubkey_policy::ID))),
            program: pubkey_policy::ID,
        };
        let data = if whitelist {
            pubkey_policy::instruction::SetWhitelisted {
                params: pubkey_policy::SetWhitelistedParams {
                    subject: to_program_pubkey(&subject),
                    whitelisted: value,
                },
            }
            .data()
        } else {
            pubkey_policy::instruction::SetBlacklisted {
                params: pubkey_policy::SetBlacklistedParams {
                    subject: to_program_pubkey(&subject),
                    blacklisted: value,
                },
            }
            .data()
        };
        let mut instruction = ix(
            pubkey_policy::ID,
            accounts,
            pubkey_policy::instruction::SetMode { mode: PubkeyPolicyMode::Open },
        );
        instruction.data = data;
        instruction
    }

    pub(crate) fn thaw(&self) -> Instruction {
        self.thaw_for(self.ata(), self.recipient())
    }
    pub(crate) fn thaw_for(&self, account: Pubkey, owner: Pubkey) -> Instruction {
        block_on(token_acl_client::create_thaw_permissionless_instruction_with_extra_metas(
            &self.f.payer,
            &account,
            &self.f.token_mint,
            &self.config(),
            &token2022::ID,
            &owner,
            false,
            |key| {
                ready(Ok(self.f.context.account_store.borrow().get(&key).map(|a| a.data.clone())))
            },
        ))
        .unwrap()
    }
    /// The Endpoint's outbound nonce for this OFT's `DST_EID` peer; `send` increments it.
    pub(crate) fn outbound_nonce(&self) -> u64 {
        let key = Pubkey::find_program_address(
            &[b"Nonce", self.f.oft_store.as_ref(), &DST_EID.to_be_bytes(), &[0x44; 32]],
            &host(endpoint::ID),
        )
        .0;
        read_account::<endpoint::accounts::Nonce>(&self.f.context, &key).outbound_nonce
    }
    pub(crate) fn supply(&self) -> u64 {
        StateWithExtensions::<Mint>::unpack(&self.account(self.f.token_mint).data)
            .unwrap()
            .base
            .supply
    }
    /// Configure the fee deposit as the credit-redirect escrow.
    pub(crate) fn redirect(&self) {
        self.ok(&[set_credit_redirect_config_ix(&self.f, self.f.admin, Some(self.f.fee_deposit))]);
    }
    /// The OFT admin's DefaultAdmin role member.
    pub(crate) fn oft_admin_role(&self) -> anchor_lang::prelude::Pubkey {
        to_program_pubkey(&role_member_pda(
            &self.f.oft_store,
            console_oft::state::RoleType::DefaultAdmin,
            &self.f.admin,
        ))
    }
    pub(crate) fn set_permissionless_thaw(&self, enabled: bool) {
        let manager = host(token_manager::ID);
        self.ok(&[ix(
            token_manager::ID,
            token_manager::accounts::ManageAcl {
                authority: to_program_pubkey(&self.f.admin),
                token_manager: to_program_pubkey(&self.token_manager),
                acl_signer: to_program_pubkey(&signer(self.token_manager, SignerKind::Acl)),
                mint_config: to_program_pubkey(&self.config()),
                acl_program: to_program_pubkey(&token_acl_interface::TOKEN_ACL_ID),
                role_member: to_program_pubkey(&role(
                    self.token_manager,
                    RoleType::DefaultAdmin,
                    self.f.admin,
                )),
                event_authority: to_program_pubkey(&event(manager)),
                program: token_manager::ID,
            },
            token_manager::instruction::SetAclPermissions {
                params: token_manager::AclPermissions {
                    freeze_enabled: true,
                    thaw_enabled: enabled,
                },
            },
        )]);
    }
    pub(crate) fn params(&self) -> LzReceiveParams {
        LzReceiveParams {
            src_eid: DST_EID,
            sender: [0x44; 32],
            nonce: 1,
            guid: [0x77; 32],
            message: codec::msg::encode(
                self.recipient().to_bytes(),
                1_000,
                to_program_pubkey(&self.f.admin),
                self.compose.then_some(&[0x42][..]),
            ),
            extra_data: vec![],
        }
    }
    pub(crate) fn seed<T: AccountSerialize + anchor_lang::Owner>(&self, key: Pubkey, value: T) {
        let mut data = vec![];
        value.try_serialize(&mut data).unwrap();
        // Preserve space reserved for optional fields in an existing account.
        data.resize(data.len().max(self.account(key).data.len()), 0);
        self.f
            .context
            .account_store
            .borrow_mut()
            .insert(key, Account { data, ..Account::new(10_000_000, 0, &host(T::owner())) });
    }
    /// Seed an existing token account for an arbitrary owner — the composer's own holdings.
    /// Left in whatever state the mint's default dictates; planning only reads its data.
    pub(crate) fn open_token_account(&self, address: Pubkey, owner: Pubkey) {
        let mint = self.account(self.f.token_mint);
        let size = spl_token_2022_interface::extension::account_len::try_calculate_account_len_from_mint_data(&mint.data, &[]).unwrap();
        self.f
            .context
            .account_store
            .borrow_mut()
            .insert(address, Account::new(10_000_000, size, &self.token_program));
        self.ok(&[token::initialize_account3(
            &self.token_program,
            &address,
            &self.f.token_mint,
            &owner,
        )
        .unwrap()]);
    }

    /// Stand in for the credit the first hop's `lz_receive` mints into the composer: the mint
    /// authority is the OFT store PDA, which a test cannot sign for. The offsets are the SPL
    /// token account's `amount` and the mint's `supply`.
    pub(crate) fn credit(&self, token_account: Pubkey, amount: u64) {
        let mut store = self.f.context.account_store.borrow_mut();
        store.get_mut(&token_account).unwrap().data[64..72].copy_from_slice(&amount.to_le_bytes());
        let mint = store.get_mut(&self.f.token_mint).unwrap();
        let supply = u64::from_le_bytes(mint.data[36..44].try_into().unwrap());
        mint.data[36..44].copy_from_slice(&(supply + amount).to_le_bytes());
    }

    /// Turn the OFT's fee on or off. A non-zero fee makes `send` sweep escrow -> fee_deposit,
    /// which puts a second transfer-hook group in the plan.
    pub(crate) fn set_default_fee_bps(&self, fee_bps: u16) {
        let mut store: OFTStore = read_account(&self.f.context, &self.f.oft_store);
        store.default_fee_bps = fee_bps;
        store
            .try_serialize(
                &mut self
                    .f
                    .context
                    .account_store
                    .borrow_mut()
                    .get_mut(&self.f.oft_store)
                    .unwrap()
                    .data
                    .as_mut_slice(),
            )
            .unwrap();
    }

    pub(crate) fn payload(&self) -> Pubkey {
        let p = self.params();
        Pubkey::find_program_address(
            &[
                b"PayloadHash",
                self.f.oft_store.as_ref(),
                &DST_EID.to_be_bytes(),
                &p.sender,
                &p.nonce.to_be_bytes(),
            ],
            &host(endpoint::ID),
        )
        .0
    }
    pub(crate) fn verify(&self) {
        let p = self.params();
        let endpoint_id = host(endpoint::ID);
        let (pubkey_policy, bump) =
            Pubkey::find_program_address(&[b"OApp", self.f.oft_store.as_ref()], &endpoint_id);
        self.seed(
            pubkey_policy,
            endpoint::accounts::OAppRegistry { delegate: to_program_pubkey(&self.f.admin), bump },
        );
        let (nonce, bump) = Pubkey::find_program_address(
            &[b"Nonce", self.f.oft_store.as_ref(), &DST_EID.to_be_bytes(), &p.sender],
            &endpoint_id,
        );
        self.seed(nonce, endpoint::accounts::Nonce { bump, inbound_nonce: 1, outbound_nonce: 0 });
        let (settings, bump) = Pubkey::find_program_address(&[b"Endpoint"], &endpoint_id);
        self.seed(
            settings,
            endpoint::accounts::EndpointSettings {
                bump,
                eid: 1,
                admin: to_program_pubkey(&self.f.admin),
                lz_token_mint: None,
            },
        );
        let (payload, bump) = Pubkey::find_program_address(
            &[
                b"PayloadHash",
                self.f.oft_store.as_ref(),
                &DST_EID.to_be_bytes(),
                &p.sender,
                &p.nonce.to_be_bytes(),
            ],
            &endpoint_id,
        );
        self.seed(
            payload,
            endpoint::accounts::PayloadHash {
                bump,
                hash: solana_keccak_hasher::hashv(&[&p.guid, &p.message]).to_bytes(),
            },
        );
    }
    /// Step 1: ask the program which accounts `lz_receive_types_v3` needs, rather than
    /// hardcoding them. Returns them in the order `LzReceiveTypesV3` declares.
    pub(crate) fn info(&self) -> Vec<Pubkey> {
        let (types_accounts, _) = Pubkey::find_program_address(
            &[b"LzReceiveTypes", self.f.oft_store.as_ref()],
            &program_id(),
        );
        let instruction = ix(
            console_oft::ID,
            console_oft::accounts::LzReceiveTypesInfo {
                oft_store: to_program_pubkey(&self.f.oft_store),
                lz_receive_types_accounts: to_program_pubkey(&types_accounts),
            },
            console_oft::instruction::LzReceiveTypesInfo { params: self.params() },
        );
        for meta in &instruction.accounts {
            self.f.context.account_store.borrow_mut().entry(meta.pubkey).or_default();
        }
        let result = self.f.context.process_instruction(&instruction);
        assert!(result.program_result.is_ok(), "types info: {:?}", result.program_result);
        let (version, accounts): (u8, LzReceiveTypesV3Accounts) =
            AnchorDeserialize::deserialize(&mut &result.return_data[..]).unwrap();
        assert_eq!(version, LZ_RECEIVE_TYPES_VERSION);
        accounts.accounts.into_iter().map(host).collect()
    }

    /// Step 2: the planner, built from whatever step 1 named.
    pub(crate) fn planner(&self) -> Instruction {
        let [oft_store, oft_escrow, token_mint, token_dest, token_program, meta_list, pubkey_policy, mint_config, thaw_metas, redirect_escrow] =
            self.info()[..]
        else {
            panic!("lz_receive_types_info must name ten accounts")
        };
        let sentinel = program_id();
        let planner = ix(
            console_oft::ID,
            console_oft::accounts::LzReceiveTypesV3 {
                payer: to_program_pubkey(&self.f.payer),
                plan_out: to_program_pubkey(&self.scratch()),
                oft_store: to_program_pubkey(&oft_store),
                oft_escrow: to_program_pubkey(&oft_escrow),
                token_mint: to_program_pubkey(&token_mint),
                token_dest: to_program_pubkey(&token_dest),
                token_program: to_program_pubkey(&token_program),
                extra_account_meta_list: (meta_list != sentinel)
                    .then(|| to_program_pubkey(&meta_list)),
                pubkey_policy: (pubkey_policy != sentinel)
                    .then(|| to_program_pubkey(&pubkey_policy)),
                acl_mint_config: (mint_config != sentinel).then(|| to_program_pubkey(&mint_config)),
                acl_thaw_metas: (thaw_metas != sentinel).then(|| to_program_pubkey(&thaw_metas)),
                redirect_escrow: (redirect_escrow != sentinel)
                    .then(|| to_program_pubkey(&redirect_escrow)),
            },
            console_oft::instruction::LzReceiveTypesV3 { params: self.params() },
        );
        // process_instruction requires absent keys in its store, unlike run() above.
        for meta in &planner.accounts {
            self.f.context.account_store.borrow_mut().entry(meta.pubkey).or_default();
        }
        planner
    }
    pub(crate) fn plan(&self) -> InstructionResult {
        self.f.context.process_instruction(&self.planner())
    }

    /// A fresh scratch for every plan, the way a client generates a new keypair each time —
    /// the planner rejects one that already holds a plan. Keeps whatever size a test chose.
    pub(crate) fn scratch(&self) -> Pubkey {
        let mut store = self.f.context.account_store.borrow_mut();
        let space = store.get(&plan_scratch()).map_or(PLAN_SCRATCH_BYTES, |a| a.data.len());
        store.insert(plan_scratch(), scratch_account(program_id(), space));
        plan_scratch()
    }
    pub(crate) fn metas(&self, accounts: &[AccountMetaRef]) -> Vec<AccountMeta> {
        accounts
            .iter()
            .map(|a| AccountMeta {
                pubkey: match a.pubkey {
                    AddressLocator::Address(k) => host(k),
                    AddressLocator::Payer => self.f.payer,
                    _ => panic!("unexpected locator"),
                },
                is_signer: matches!(a.pubkey, AddressLocator::Payer),
                is_writable: a.is_writable,
            })
            .collect()
    }

    /// Step 3: the whole plan, in the order the planner gave it. The Executor submits these
    /// as one atomic transaction, so the tests do too.
    pub(crate) fn instructions(&self) -> Vec<Instruction> {
        let result = self.plan();
        assert!(result.program_result.is_ok(), "planner: {:?}", result.program_result);
        let plan: LzReceiveTypesV3Result = decode_plan(&result, &plan_scratch());
        plan.instructions
            .iter()
            .map(|planned| match planned {
                oapp::lz_receive_types_v3::Instruction::LzReceive { accounts } => Instruction {
                    program_id: program_id(),
                    data: console_oft::instruction::LzReceive { params: self.params() }.data(),
                    accounts: self.metas(accounts),
                },
                oapp::lz_receive_types_v3::Instruction::Standard { program_id, accounts, data } => {
                    Instruction {
                        program_id: host(*program_id),
                        data: data.clone(),
                        accounts: self.metas(accounts),
                    }
                },
            })
            .collect()
    }

    /// There is exactly one emitted instruction; never discard preparatory work in tests.
    pub(crate) fn receive(&self) -> Instruction {
        let mut instructions = self.instructions();
        assert_eq!(instructions.len(), 1, "receive owns inline activation");
        instructions.pop().unwrap()
    }
    pub(crate) fn delivered(&self, destination: Pubkey) {
        assert_eq!(self.token(destination).amount, 1_000);
        assert_eq!(self.token(self.f.oft_escrow).amount, 0);
        assert!(
            self.account(self.payload()).data.is_empty(),
            "Endpoint clear must consume verified payload"
        );
        assert_eq!(
            StateWithExtensions::<Mint>::unpack(&self.account(self.f.token_mint).data)
                .unwrap()
                .base
                .supply,
            1_000
        );
    }
}

pub(crate) fn set_policy(h: &Harness, policy: Option<Pubkey>) -> Instruction {
    ix(
        console_oft::ID,
        console_oft::accounts::SetPubkeyPolicy {
            authority: to_program_pubkey(&h.f.admin),
            oft_store: to_program_pubkey(&h.f.oft_store),
            pubkey_policy: policy.as_ref().map(to_program_pubkey),
            role_member: h.oft_admin_role(),
            event_authority: to_program_pubkey(&event(program_id())),
            program: console_oft::ID,
        },
        console_oft::instruction::SetPubkeyPolicy {},
    )
}

/// Canonical ACL permits external logical admins, but the manager no longer exposes
/// an outbound handoff. Seed this native state explicitly to test the consumer's
/// binding boundary, not as an advertised manager lifecycle.
pub(crate) fn set_external_acl_admin_for_boundary_test(h: &Harness) {
    let mut account = h.account(h.config());
    let mut config = MintConfig::from_bytes(&account.data).unwrap();
    config.freeze_authority = h.f.admin;
    account.data.clear();
    config.serialize(&mut account.data).unwrap();
    h.f.context.account_store.borrow_mut().insert(h.config(), account);
}

// Keep rate limiting active in profiles; a globally disabled limiter understates hot-path cost.
pub(crate) fn configure_profile(h: &Harness, lock_unlock: bool) {
    let mut store: OFTStore = read_account(&h.f.context, &h.f.oft_store);
    store.oft_type = if lock_unlock {
        ::oft::types::OftType::LockUnlock
    } else {
        ::oft::types::OftType::BurnMint
    };
    store.use_global_state = true;
    store.is_globally_disabled = false;
    h.seed(h.f.oft_store, store);
    h.seed(
        h.f.default_rate_limit,
        console_oft::state::RateLimit {
            config: console_oft::state::RateLimitConfig {
                outbound_limit: 1_000_000,
                inbound_limit: 1_000_000,
                outbound_window: 60,
                inbound_window: 60,
                ..Default::default()
            },
            state: Default::default(),
        },
    );
}

/// Where `lz_receive`'s optional screening accounts sit in its account list, read from the
/// generated client struct so tests that blank a slot follow the program's declaration order.
pub(crate) struct LzReceiveSlots {
    pub(crate) pubkey_policy: usize,
    pub(crate) pubkey_policy_record: usize,
    /// mint config, thaw manifest, flag, ACL program, gate program.
    pub(crate) acl: [usize; 5],
}

pub(crate) fn lz_receive_slots() -> LzReceiveSlots {
    let m = |i: u8| anchor_lang::prelude::Pubkey::new_from_array([i; 32]);
    let metas = console_oft::accounts::LzReceive {
        payer: m(1),
        oft_store: m(2),
        peer: m(3),
        default_rate_limit: m(4),
        rate_limit: m(5),
        address_exemption: m(6),
        oft_escrow: m(7),
        to_address: m(8),
        token_dest: m(9),
        redirect_escrow: Some(m(10)),
        pubkey_policy: Some(m(11)),
        pubkey_policy_record: Some(m(12)),
        token_mint: m(13),
        mint_authority: Some(m(14)),
        token_program: m(15),
        associated_token_program: m(16),
        system_program: m(17),
        acl_mint_config: Some(m(18)),
        acl_thaw_metas: Some(m(19)),
        acl_flag: Some(m(20)),
        acl_program: Some(m(21)),
        acl_gate_program: Some(m(22)),
        event_authority: m(24),
        program: m(25),
    }
    .to_account_metas(None);
    let at = |i| metas.iter().position(|meta| meta.pubkey == m(i)).unwrap();
    LzReceiveSlots {
        pubkey_policy: at(11),
        pubkey_policy_record: at(12),
        acl: [at(18), at(19), at(20), at(21), at(22)],
    }
}

/// The index of `key` in `instruction`, which must name it exactly once.
pub(crate) fn slot_of(instruction: &Instruction, key: Pubkey) -> usize {
    let mut slots = instruction.accounts.iter().enumerate().filter(|(_, meta)| meta.pubkey == key);
    let (slot, _) = slots.next().expect("account not in instruction");
    assert!(slots.next().is_none(), "account appears more than once");
    slot
}

/// `send` with its `SendParams` edited; the harness builds sends of 100 with no minimum.
pub(crate) fn with_send_params(
    mut send: Instruction,
    edit: impl FnOnce(&mut ::oft::types::SendParams),
) -> Instruction {
    let mut params = ::oft::types::SendParams::deserialize(&mut &send.data[8..]).unwrap();
    edit(&mut params);
    send.data = console_oft::instruction::Send { params }.data();
    send
}

pub(crate) fn failure(error: impl Into<u32>) -> TransactionProgramResult {
    TransactionProgramResult::Failure(0, ProgramError::Custom(error.into()))
}
