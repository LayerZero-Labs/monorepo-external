//! Resource budgets: plan transport, Transaction V1 address fit, CPI depth, and the CU/key
//! profiles `scripts/profile-acl.ts` compiles into real V1 envelopes.

use crate::harness::*;

/// Transaction V1 caps a message at 64 distinct addresses and has no address lookup tables, so
/// every executed plan must fit that whole, inside the Executor's bracket.
const TRANSACTION_V1_ADDRESS_LIMIT: usize = 64;

/// Addresses the Executor's pre/post bracket adds that a plan cannot name: the Executor program,
/// its execution-context PDA and the instructions sysvar (`preExecute`'s accounts in
/// `lz-v2-protocol-solana`). Its payer and the System program are already in the plan, and
/// V1 carries compute budgets in its header, so there is no ComputeBudget program.
const EXECUTOR_BRACKET_ADDRESSES: usize = 3;

impl Harness {
    /// Stand up the multihop composer: its store, its holdings, and the send-library program it
    /// re-sends through. `tail` is whatever that library adds after the Endpoint's ten accounts;
    /// the composer is told rather than deriving it (see the fixture's crate doc).
    pub(crate) fn multihop_store(
        &self,
        send_library_program: Pubkey,
        tail: Vec<multihop_composer::PlannedAccount>,
    ) -> (Pubkey, Pubkey) {
        let (store, bump) = Pubkey::find_program_address(
            &[multihop_composer::COMPOSER_SEED],
            &host(multihop_composer::ID),
        );
        let mut data = vec![];
        multihop_composer::ComposerStore {
            token_mint: to_program_pubkey(&self.f.token_mint),
            oft_store: to_program_pubkey(&self.f.oft_store),
            fee_deposit: to_program_pubkey(&self.f.fee_deposit),
            token_manager: to_program_pubkey(&self.token_manager),
            send_library_program: to_program_pubkey(&send_library_program),
            send_library_tail: tail,
            bump,
        }
        .try_serialize(&mut data)
        .unwrap();
        self.f.context.account_store.borrow_mut().insert(
            store,
            Account { data, ..Account::new(10_000_000, 0, &host(multihop_composer::ID)) },
        );
        let ata = spl_associated_token_account_interface::address::get_associated_token_address_with_program_id(
            &store,
            &self.f.token_mint,
            &self.token_program,
        );
        self.open_token_account(ata, store);
        (store, ata)
    }

    /// The compose payload the planner and `lz_compose` both decode: the OFT's compose envelope
    /// with the second hop's borsh-encoded `SendParams` as its tail.
    pub(crate) fn multihop_params(
        &self,
        store: Pubkey,
        amount_ld: u64,
    ) -> oapp::types::LzComposeParams {
        let mut message =
            console_oft::codec::compose_msg::encode(1, DST_EID, amount_ld, &[0u8; 32]);
        message.extend_from_slice(
            &borsh::to_vec(&::oft::types::SendParams {
                dst_eid: DST_EID,
                to: [0x66; 32],
                amount_ld,
                min_amount_ld: 0,
                extra_options: lz_receive_options(),
                compose_msg: None,
                native_fee: 0,
                lz_token_fee: 0,
            })
            .unwrap(),
        );
        oapp::types::LzComposeParams {
            from: to_program_pubkey(&self.f.oft_store),
            to: to_program_pubkey(&store),
            guid: self.params().guid,
            index: 0,
            message,
            extra_data: vec![],
        }
    }

    /// Run the multihop composer's planner over that payload.
    pub(crate) fn multihop_plan(
        &self,
        store: Pubkey,
        composer_ata: Pubkey,
        amount_ld: u64,
    ) -> oapp::lz_compose_types_v3::LzComposeTypesV3Result {
        let params = self.multihop_params(store, amount_ld);
        let plan_out = Pubkey::new_from_array([0x9f; 32]);
        let endpoint_id = host(endpoint::ID);
        let send_library_config = Pubkey::find_program_address(
            &[b"SendLibraryConfig", self.f.oft_store.as_ref(), &DST_EID.to_be_bytes()],
            &endpoint_id,
        )
        .0;
        let default_send_library_config = Pubkey::find_program_address(
            &[b"SendLibraryConfig", &DST_EID.to_be_bytes()],
            &endpoint_id,
        )
        .0;
        let instruction = ix(
            multihop_composer::ID,
            multihop_composer::accounts::LzComposeTypesV3 {
                payer: to_program_pubkey(&self.f.payer),
                plan_out: to_program_pubkey(&plan_out),
                composer_store: to_program_pubkey(&store),
                token_mint: to_program_pubkey(&self.f.token_mint),
                composer_token_account: to_program_pubkey(&composer_ata),
                oft_store: to_program_pubkey(&self.f.oft_store),
                oft_escrow: to_program_pubkey(&self.f.oft_escrow),
                fee_deposit: to_program_pubkey(&self.f.fee_deposit),
                peer: to_program_pubkey(&self.f.peer),
                fee_config: to_program_pubkey(&fee_config_pda(&self.f.oft_store, DST_EID.into())),
                send_library_config: to_program_pubkey(&send_library_config),
                default_send_library_config: to_program_pubkey(&default_send_library_config),
                extra_account_meta_list: self
                    .hook
                    .then(|| to_program_pubkey(&self.hook_manifest())),
            },
            multihop_composer::instruction::LzComposeTypesV3 { params: params.clone() },
        );
        let types_account = Pubkey::find_program_address(
            &[oapp::LZ_COMPOSE_TYPES_SEED, store.as_ref()],
            &host(multihop_composer::ID),
        )
        .0;
        let info = ix(
            multihop_composer::ID,
            multihop_composer::accounts::LzComposeTypesInfo {
                composer_store: to_program_pubkey(&store),
                lz_compose_types_accounts: to_program_pubkey(&types_account),
                token_mint: to_program_pubkey(&self.f.token_mint),
            },
            multihop_composer::instruction::LzComposeTypesInfo { params },
        );
        for meta in &info.accounts {
            self.f.context.account_store.borrow_mut().entry(meta.pubkey).or_default();
        }
        let result = self.f.context.process_instruction(&info);
        assert!(result.program_result.is_ok(), "multihop info: {:?}", result.program_result);
        let (_, discovered): (u8, oapp::lz_compose_types_v3::LzComposeTypesV3Accounts) =
            decode_return(&result.return_data);
        assert_eq!(
            discovered.accounts.into_iter().map(host).collect::<Vec<_>>(),
            instruction.accounts[2..].iter().map(|meta| meta.pubkey).collect::<Vec<_>>()
        );
        for meta in &instruction.accounts {
            self.f.context.account_store.borrow_mut().entry(meta.pubkey).or_default();
        }
        self.f
            .context
            .account_store
            .borrow_mut()
            .insert(plan_out, scratch_account(host(multihop_composer::ID), PLAN_SCRATCH_BYTES));
        let result = self.f.context.process_instruction(&instruction);
        assert!(result.program_result.is_ok(), "multihop planner: {:?}", result.program_result);
        let required: u32 = decode_return(&result.return_data);
        let account = &result.resulting_accounts.iter().find(|(k, _)| k == &plan_out).unwrap().1;
        AnchorDeserialize::deserialize(&mut &account.data[..required as usize]).unwrap()
    }

    /// Write an Anchor account for a program this crate has no Rust bindings for.
    pub(crate) fn seed_foreign<T: borsh::BorshSerialize>(
        &self,
        key: Pubkey,
        owner: Pubkey,
        discriminator: [u8; 8],
        value: &T,
    ) {
        let mut data = discriminator.to_vec();
        value.serialize(&mut data).unwrap();
        self.f
            .context
            .account_store
            .borrow_mut()
            .insert(key, Account { data, ..Account::new(10_000_000, 0, &owner) });
    }

    /// Point the Endpoint at the real ULN302 and stand up everything that library reaches: one
    /// DVN, the Executor, and the price feed both of them quote through. Returns the account
    /// tail ULN adds after the Endpoint's ten, in `send-helper.ts:467` order — the executable
    /// counterpart of the synthetic [`uln_tail`] the plan test measures with.
    ///
    /// Each program runs its real SBF binary; only its configuration is written directly, the
    /// way this harness already seeds the Endpoint's own state.
    ///
    /// Every worker price is zero because the second hop's `SendParams` carries
    /// `native_fee: 0`; a non-zero quote would fail the send on fee, not on depth.
    pub(crate) fn install_uln(&mut self) -> Vec<multihop_composer::PlannedAccount> {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        for (id, binary) in [
            (uln302::uln(), "target/programs/uln"),
            (uln302::dvn(), "target/programs/dvn"),
            (uln302::executor(), "target/programs/executor"),
            (uln302::pricefeed(), "target/programs/pricefeed"),
        ] {
            self.f.context.mollusk.add_program(&id, root.join(binary).to_str().unwrap());
            self.f
                .context
                .account_store
                .borrow_mut()
                .insert(id, mollusk_svm::program::create_program_account_loader_v3(&id));
        }

        let endpoint_id = host(endpoint::ID);
        let eid = DST_EID.to_be_bytes();
        let pda = |seeds: &[&[u8]], program: Pubkey| Pubkey::find_program_address(seeds, &program);
        let (settings, settings_bump) = pda(&[b"MessageLib"], uln302::uln());
        let (info, info_bump) = pda(&[b"MessageLib", settings.as_ref()], endpoint_id);
        self.seed(
            info,
            endpoint::accounts::MessageLibInfo {
                message_lib_type: endpoint::types::MessageLibType::Send,
                bump: info_bump,
                message_lib_bump: settings_bump,
            },
        );
        for seeds in [
            vec![b"SendLibraryConfig".to_vec(), self.f.oft_store.to_bytes().to_vec(), eid.to_vec()],
            vec![b"SendLibraryConfig".to_vec(), eid.to_vec()],
        ] {
            let parts: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();
            let (key, bump) = pda(&parts, endpoint_id);
            self.seed(
                key,
                endpoint::accounts::SendLibraryConfig {
                    message_lib: to_program_pubkey(&settings),
                    bump,
                },
            );
        }

        let (price_feed, price_feed_bump) = pda(&[b"PriceFeed"], uln302::pricefeed());
        let (dvn_config, dvn_bump) = pda(&[b"DvnConfig"], uln302::dvn());
        let (executor_config, executor_bump) = pda(&[b"ExecutorConfig"], uln302::executor());
        let (default_send_config, default_bump) = pda(&[b"SendConfig", &eid], uln302::uln());
        let oapp_send_config =
            pda(&[b"SendConfig", &eid, self.f.oft_store.as_ref()], uln302::uln()).0;

        self.seed_foreign(
            settings,
            uln302::uln(),
            uln302::UlnSettings::DISCRIMINATOR,
            &uln302::UlnSettings {
                eid: 1,
                // The Endpoint signs a message-library CPI as that library's registration
                // account, not as its own settings PDA.
                endpoint: info,
                endpoint_program: endpoint_id,
                bump: settings_bump,
                admin: self.f.admin,
                treasury: None,
            },
        );
        self.seed_foreign(
            default_send_config,
            uln302::uln(),
            uln302::SendConfig::DISCRIMINATOR,
            &uln302::SendConfig {
                bump: default_bump,
                uln: uln302::UlnConfig {
                    confirmations: 1,
                    required_dvn_count: 1,
                    optional_dvn_count: 0,
                    optional_dvn_threshold: 0,
                    required_dvns: vec![dvn_config],
                    optional_dvns: vec![],
                },
                executor: uln302::ExecutorRef {
                    max_message_size: 10_000,
                    executor: executor_config,
                },
            },
        );
        self.seed_foreign(
            dvn_config,
            uln302::dvn(),
            uln302::DvnConfig::DISCRIMINATOR,
            &uln302::DvnConfig {
                vid: 0,
                bump: dvn_bump,
                multisig: uln302::Multisig { signers: vec![[0u8; 64]], quorum: 1 },
                acl: uln302::Acl { allow_list: vec![], deny_list: vec![] },
                paused: false,
                msglibs: vec![settings],
                admins: vec![self.f.admin],
                price_feed,
                dst_configs: vec![uln302::DvnDstConfig {
                    eid: DST_EID,
                    dst_gas: 100_000,
                    multiplier_bps: None,
                    floor_margin_usd: None,
                }],
                default_multiplier_bps: 10_000,
            },
        );
        self.seed_foreign(
            executor_config,
            uln302::executor(),
            uln302::ExecutorConfig::DISCRIMINATOR,
            &uln302::ExecutorConfig {
                bump: executor_bump,
                owner: self.f.admin,
                acl: uln302::Acl { allow_list: vec![], deny_list: vec![] },
                admins: vec![self.f.admin],
                executors: vec![self.f.payer],
                msglibs: vec![settings],
                paused: false,
                default_multiplier_bps: 10_000,
                price_feed,
                dst_configs: vec![uln302::ExecutorDstConfig {
                    eid: DST_EID,
                    lz_receive_base_gas: 10_000,
                    lz_compose_base_gas: 10_000,
                    multiplier_bps: None,
                    floor_margin_usd: None,
                    native_drop_cap: 0,
                }],
            },
        );
        self.seed_foreign(
            price_feed,
            uln302::pricefeed(),
            uln302::PriceFeed::DISCRIMINATOR,
            &uln302::PriceFeed {
                admin: self.f.admin,
                updaters: vec![],
                price_ratio_denominator: 100_000_000_000_000_000_000,
                arbitrum_compression_percent: 47,
                native_token_price_usd: None,
                prices: vec![uln302::Price {
                    eid: DST_EID,
                    price_ratio: 0,
                    gas_price_in_unit: 0,
                    gas_per_byte: 0,
                    model_type: None,
                }],
                bump: price_feed_bump,
            },
        );

        let mut tail = vec![
            planned(settings, false, false),
            planned(oapp_send_config, false, false),
            planned(default_send_config, false, false),
            planned(Pubkey::default(), true, true), // payer: the Executor pays the native fee
            planned(uln302::uln(), false, false),   // no treasury: Anchor's absent-account default
            planned(Pubkey::default(), false, false), // system program
            planned(event(uln302::uln()), false, false),
            planned(uln302::uln(), false, false),
        ];
        for (program, config) in
            [(uln302::executor(), executor_config), (uln302::dvn(), dvn_config)]
        {
            tail.extend([
                planned(program, false, false),
                planned(config, true, false), // receives the worker's fee
                planned(uln302::pricefeed(), false, false),
                planned(price_feed, false, false),
            ]);
        }
        tail
    }

    /// Materialize the planned `lz_compose` the way the Executor submits it: the composer's own
    /// five accounts fill its `Accounts` struct and everything after is `remaining_accounts`.
    pub(crate) fn multihop_compose(
        &self,
        store: Pubkey,
        accounts: &[AccountMetaRef],
        amount_ld: u64,
    ) -> Instruction {
        Instruction {
            program_id: host(multihop_composer::ID),
            data: multihop_composer::instruction::LzCompose {
                params: self.multihop_params(store, amount_ld),
            }
            .data(),
            accounts: self.metas(accounts),
        }
    }

    /// The Endpoint's record of the composed message, as the first hop's `send_compose` left it.
    /// `lz_compose` clears it before spending the credit.
    pub(crate) fn seed_compose_state(&self, store: Pubkey, amount_ld: u64) {
        let params = self.multihop_params(store, amount_ld);
        let (key, bump) = Pubkey::find_program_address(
            &[
                b"ComposedMessageHash",
                self.f.oft_store.as_ref(),
                store.as_ref(),
                &params.guid,
                &params.index.to_be_bytes(),
                &solana_keccak_hasher::hash(&params.message).to_bytes(),
            ],
            &host(endpoint::ID),
        );
        self.seed(key, endpoint::accounts::ComposeMessageState { received: false, bump });
    }

    /// `lz_compose` hands the plan's accounts to Anchor's `Send` CPI struct positionally, so
    /// rebuild that struct's order out of the plan. Indices follow the layout documented at
    /// `tests/programs/multihop_composer/src/instructions/lz_compose.rs:12`.
    pub(crate) fn planned_send_keys(&self, accounts: &[AccountMetaRef]) -> Vec<Pubkey> {
        let at = |i: usize| match accounts[i].pubkey {
            AddressLocator::Address(k) => host(k),
            _ => panic!("the send group never uses a locator"),
        };
        let mut keys = vec![at(0)]; // signer: the composer store PDA
        keys.extend((10..18).map(at)); // oft_store .. address_exemption
        keys.push(at(1)); // token_source
        keys.extend([at(18), at(19), at(2), at(3)]); // escrow, fee_deposit, mint, token_program
        keys.extend((20..25).map(at)); // burn_policy .. event_authority
        keys.push(at(4)); // program
        keys
    }

    /// What Anchor emits for the same send. Compared by address only: signer and writability
    /// flags belong to the composer's own `Accounts` struct, not to the OFT's.
    pub(crate) fn expected_send_keys(
        &self,
        composer_store: Pubkey,
        composer_ata: Pubkey,
    ) -> Vec<Pubkey> {
        let f = &self.f;
        let enforced = Pubkey::find_program_address(
            console_oft::EnforcedOptions::seeds(&to_program_pubkey(&f.oft_store), DST_EID, 1),
            &program_id(),
        )
        .0;
        ix(
            console_oft::ID,
            console_oft::accounts::Send {
                signer: to_program_pubkey(&composer_store),
                oft_store: to_program_pubkey(&f.oft_store),
                peer: to_program_pubkey(&f.peer),
                enforced_options: to_program_pubkey(&enforced),
                pause_config: to_program_pubkey(&pause_config_pda(&f.oft_store, DST_EID.into())),
                fee_config: to_program_pubkey(&fee_config_pda(&f.oft_store, DST_EID.into())),
                default_rate_limit: to_program_pubkey(&f.default_rate_limit),
                rate_limit: to_program_pubkey(&rate_limit_pda(&f.oft_store, DST_EID.into())),
                address_exemption: to_program_pubkey(&rate_limit_address_exemption_pda(
                    &f.oft_store,
                    &composer_store,
                )),
                token_source: to_program_pubkey(&composer_ata),
                oft_escrow: to_program_pubkey(&f.oft_escrow),
                fee_deposit: Some(to_program_pubkey(&f.fee_deposit)),
                token_mint: to_program_pubkey(&f.token_mint),
                token_program: to_program_pubkey(&self.token_program),
                burn_policy: self.pb.then(|| to_program_pubkey(&self.token_manager)),
                burn_role: self.pb.then(|| {
                    to_program_pubkey(&role(self.token_manager, RoleType::Burner, f.oft_escrow))
                }),
                burn_manager: self.pb.then_some(token_manager::ID),
                burn_signer: self.pb.then(|| {
                    to_program_pubkey(&signer(self.token_manager, SignerKind::PermissionedBurn))
                }),
                event_authority: to_program_pubkey(&event(program_id())),
                program: console_oft::ID,
            },
            console_oft::instruction::Send {
                params: ::oft::types::SendParams {
                    dst_eid: DST_EID,
                    to: [0x66; 32],
                    amount_ld: 1_000,
                    min_amount_ld: 0,
                    extra_options: vec![],
                    compose_msg: None,
                    native_fee: 0,
                    lz_token_fee: 0,
                },
            },
        )
        .accounts
        .into_iter()
        .map(|meta| meta.pubkey)
        .collect()
    }
}

/// Reproducible profile consumed by scripts/profile-acl.ts. CU is SBF delivery only; the script
/// separately compiles the *emitted* instructions in the real Executor V1 pre/post envelope.
#[test]
fn inline_acl_resource_profile() {
    for (name, acl, hook, compose, redirect, blocked, existing, lock_unlock) in [
        ("policy-only", false, false, false, false, false, false, false),
        ("acl-new", true, false, false, false, false, false, false),
        ("acl-existing", true, false, false, false, false, true, false),
        ("acl-hook-compose", true, true, true, true, false, false, false),
        ("acl-hook-compose-blocked", true, true, true, true, true, false, false),
        ("lock-unlock", false, false, false, false, false, false, true),
        ("lock-unlock-hook", false, true, false, false, false, false, true),
    ] {
        let mut h = Harness::new(acl, hook);
        h.compose = compose;
        configure_profile(&h, lock_unlock);
        if lock_unlock {
            h.credit(h.f.oft_escrow, 1_000);
        }
        if redirect {
            h.redirect();
        }
        if existing {
            h.ok(&[h.create_ata(), h.thaw()]);
        }
        if blocked {
            h.ok(&[h.membership(h.recipient(), false, true)]);
        }
        h.verify();
        let planning = h.plan();
        let plan: LzReceiveTypesV3Result = decode_plan(&planning, &plan_scratch());
        let instructions = h.instructions();
        let result = h.ok(&instructions);
        h.assert_inline_thaw(&result, acl && !existing && !blocked);
        let depth = result
            .inner_instructions
            .iter()
            .flatten()
            .filter_map(|inner| inner.stack_height)
            .max()
            .unwrap_or(1);
        // Wide enough to avoid compiler-noise failures, small enough to detect an extra wrapper
        // or a regression threatening the configured transaction budget.
        assert!(depth <= 4);
        assert!(result.compute_units_consumed < 350_000);
        let keys = result.message.as_ref().unwrap().account_keys().len();
        assert!(
            keys + EXECUTOR_BRACKET_ADDRESSES <= TRANSACTION_V1_ADDRESS_LIMIT,
            "{name}: {keys} delivery addresses do not fit a Transaction V1 inside the bracket"
        );
        println!(
            "ACL_PROFILE {}",
            serde_json::json!({
                "name": name, "payer": h.f.payer.to_string(),
                "planBytes": borsh::to_vec(&plan).unwrap().len(),
                "plannerCu": planning.compute_units_consumed,
                "deliveryCu": result.compute_units_consumed, "depth": depth,
                "innerInstructions": result.inner_instructions.iter().flatten().count(),
                "heapBudgetBytes": h.f.context.mollusk.compute_budget.heap_size,
                "deliveryKeys": result.message.as_ref().unwrap().account_keys().len(),
                "instructions": instructions.iter().map(|ix| serde_json::json!({
                    "programId": ix.program_id.to_string(), "data": ix.data,
                    "keys": ix.accounts.iter().map(|a| serde_json::json!({
                        "pubkey": a.pubkey.to_string(), "isSigner": a.is_signer, "isWritable": a.is_writable,
                    })).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
            })
        );
    }
}

#[test]
fn send_resource_profile() {
    for (name, hook, pb, fee, lock_unlock, uln) in [
        ("burn-mint-simple", false, false, false, false, false),
        ("burn-mint-uln", false, false, false, false, true),
        ("burn-mint-hook-uln", true, false, false, false, true),
        ("pb-hook-uln", true, true, false, false, true),
        ("pb-hook-fee-uln", true, true, true, false, true),
        ("lock-unlock-uln", false, false, false, true, true),
        ("lock-unlock-hook-fee-uln", true, false, true, true, true),
    ] {
        let mut h = Harness::with_pb(false, hook, pb);
        h.verify();
        h.ok(&[h.receive()]);
        configure_profile(&h, lock_unlock);
        h.set_default_fee_bps(if fee { 1_000 } else { 0 });
        let mut endpoint = h.send_endpoint_accounts(0);
        if uln {
            let tail = h.install_uln();
            let settings = Pubkey::find_program_address(&[b"MessageLib"], &uln302::uln()).0;
            let info = Pubkey::find_program_address(
                &[b"MessageLib", settings.as_ref()],
                &host(endpoint::ID),
            )
            .0;
            endpoint[2].pubkey = uln302::uln();
            endpoint[5].pubkey = info;
            endpoint.truncate(10);
            endpoint.extend(tail.into_iter().map(|a| AccountMeta {
                pubkey: if a.is_signer { h.f.payer } else { host(a.pubkey) },
                is_signer: a.is_signer,
                is_writable: a.is_writable,
            }));
        }
        let mut send = h.send(pb, &endpoint);
        let mut params = ::oft::types::SendParams::deserialize(&mut &send.data[8..]).unwrap();
        params.extra_options = lz_receive_options();
        send.data = console_oft::instruction::Send { params }.data();
        // Ordinary send must fit depth five, independently of Mollusk's higher default.
        h.f.context.mollusk.compute_budget.max_instruction_stack_depth = 5;
        let result = h.ok(&[send.clone()]);
        let depth = result
            .inner_instructions
            .iter()
            .flatten()
            .filter_map(|i| i.stack_height)
            .max()
            .unwrap_or(1);
        assert!(depth <= 5);
        assert!(result.compute_units_consumed < 400_000);
        assert_eq!(h.token(h.ata()).amount, 900);
        assert_eq!(
            h.token(h.f.oft_escrow).amount,
            if lock_unlock {
                if fee {
                    90
                } else {
                    100
                }
            } else {
                0
            }
        );
        assert_eq!(h.token(h.f.fee_deposit).amount, if fee { 10 } else { 0 });
        let limiter: console_oft::state::RateLimit =
            read_account(&h.f.context, &h.f.default_rate_limit);
        assert_eq!(limiter.state.outbound_usage, if fee { 90 } else { 100 });
        println!(
            "SEND_PROFILE {}",
            serde_json::json!({
                "name": name, "payer": h.f.payer.to_string(),
                "deliveryCu": result.compute_units_consumed, "depth": depth,
                "innerInstructions": result.inner_instructions.iter().flatten().count(),
                "heapBudgetBytes": h.f.context.mollusk.compute_budget.heap_size,
                "deliveryKeys": result.message.as_ref().unwrap().account_keys().len(),
                "instructions": [{ "programId": send.program_id.to_string(), "data": send.data,
                    "keys": send.accounts.iter().map(|a| serde_json::json!({
                        "pubkey": a.pubkey.to_string(), "isSigner": a.is_signer, "isWritable": a.is_writable,
                    })).collect::<Vec<_>>() }],
            })
        );
    }
}

/// A redirect doubles the hook groups, making the plan larger than a program's 1 KiB return data;
/// it travels through the caller's scratch instead and still fits the SDK's default size.
#[test]
fn a_plan_larger_than_return_data_is_delivered_through_the_scratch() {
    let h = Harness::new(false, true);
    h.redirect();
    let result = h.plan();
    assert!(result.program_result.is_ok());
    let plan: LzReceiveTypesV3Result = decode_plan(&result, &plan_scratch());
    let bytes = borsh::to_vec(&plan).unwrap().len();
    assert!(bytes > 1_024 && bytes <= PLAN_SCRATCH_BYTES, "plan is {bytes} bytes");
    assert_eq!(result.return_data.len(), 4, "return data carries only the plan's size");
    h.verify();
    h.ok(&[h.receive()]);
    h.delivered(h.ata());
}

/// The first simulation measures; the second fits. A plan too big for the SDK's default
/// scratch reports the size to re-create it with, and that size is exact.
#[test]
fn oversized_plan_reports_the_size_to_re_simulate_with() {
    use spl_tlv_account_resolution::{account::ExtraAccountMeta, state::ExtraAccountMetaList};
    use spl_transfer_hook_interface::instruction::ExecuteInstruction;
    let h = Harness::new(false, true);
    // Repeated literal metas enlarge the plan without inventing hundreds of
    // distinct transaction keys. This tests transport, not hook execution.
    let extras =
        vec![
            ExtraAccountMeta::new_with_pubkey(&to_program_pubkey(&h.f.admin), false, false)
                .unwrap();
            400
        ];
    let size = ExtraAccountMetaList::size_of(extras.len()).unwrap();
    let mut data = vec![0; size];
    ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &extras).unwrap();
    h.f.context.account_store.borrow_mut().get_mut(&h.hook_manifest()).unwrap().data = data;

    let first = h.plan();
    assert!(first.program_result.is_ok());
    let required: u32 = decode_return(&first.return_data);
    assert!(required as usize > PLAN_SCRATCH_BYTES);
    let untouched = &first.resulting_accounts.iter().find(|(k, _)| k == &plan_scratch()).unwrap().1;
    assert_eq!(untouched.data, vec![0; PLAN_SCRATCH_BYTES]);

    planner_output_sized(&h.f, required as usize);
    let result = h.plan();
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);
    assert_eq!(decode_return::<u32>(&result.return_data), required);
    let plan: LzReceiveTypesV3Result = decode_plan(&result, &plan_scratch());
    assert_eq!(borsh::to_vec(&plan).unwrap().len(), required as usize);
}

fn planned(
    pubkey: Pubkey,
    is_writable: bool,
    is_signer: bool,
) -> multihop_composer::PlannedAccount {
    multihop_composer::PlannedAccount { pubkey: to_program_pubkey(&pubkey), is_writable, is_signer }
}

/// The tail ULN302 adds after the Endpoint's ten, in the order the off-chain SDK assembles it
/// (`packages/protocol/lz-v2-protocol-solana/src/send-helper.ts:467`): the ULN's own `send`
/// accounts minus the Endpoint signer the Endpoint supplies itself, then four accounts per
/// worker — program, config, price-feed program, price-feed config — for the executor and every
/// DVN. Worker addresses are synthetic; only their count and sharing are load-bearing, and every
/// worker on a pathway shares one price feed deployment.
fn uln_tail(uln_program: Pubkey, dvns: usize) -> Vec<multihop_composer::PlannedAccount> {
    let price_feed_program = Pubkey::new_unique();
    let price_feed_config = Pubkey::new_unique();
    let mut tail = vec![
        planned(Pubkey::new_unique(), false, false), // uln settings
        planned(Pubkey::new_unique(), false, false), // send config
        planned(Pubkey::new_unique(), false, false), // default send config
        planned(Pubkey::default(), true, true),      // payer: the Executor pays the native fee
        planned(Pubkey::new_unique(), true, false),  // treasury
        planned(Pubkey::default(), false, false),    // system program
        planned(Pubkey::new_unique(), false, false), // uln event authority
        planned(uln_program, false, false),          // uln program, also send library at index 2
    ];
    for _ in 0..1 + dvns {
        tail.push(planned(Pubkey::new_unique(), false, false)); // worker program
        tail.push(planned(Pubkey::new_unique(), true, false)); // worker config, receives payment
        tail.push(planned(price_feed_program, false, false));
        tail.push(planned(price_feed_config, false, false));
    }
    tail
}

/// Type-3 options carrying one executor `lzReceive` gas option, matching
/// `Options.newOptions().addExecutorLzReceiveOption(200_000)`:
/// `[type 3][worker 1][len 17][option 1][gas u128 BE]`. ULN302 reads the options type before
/// anything else and rejects a blob with no executor gas; SimpleMessageLib ignores options.
fn lz_receive_options() -> Vec<u8> {
    let mut options = vec![0x00, 0x03, 0x01, 0x00, 0x11, 0x01];
    options.extend_from_slice(&200_000u128.to_be_bytes());
    options
}

/// The real ULN302 send path, in place of `SimpleMessageLib`.
///
/// ULN302, the DVN, the Executor and the price feed ship as SBF binaries only
/// (`target/programs/`): no Rust crate and no vendored IDL exist for them in this repo. Their
/// account layouts are mirrored here from the generated client the off-chain SDK deserializes
/// them with, `@layerzerolabs/lz-solana-sdk-v2/src/generated/kinobi/{uln,dvn,pricefeed,executor}`,
/// and the worker tail from `send-helper.ts:467`. Program ids come from the same package, which
/// is also where `test-utils-solana` sources them when it unpacks the snapshot.
mod uln302 {
    use borsh::BorshSerialize;
    use solana_pubkey::Pubkey;

    pub fn uln() -> Pubkey {
        "7a4WjyR8VZ7yZz5XJAKm39BUGn5iT9CKcv2pmG9tdXVH".parse().unwrap()
    }
    pub fn dvn() -> Pubkey {
        "HtEYV4xB4wvsj5fgTkcfuChYpvGYzgzwvNhgDZQNh7wW".parse().unwrap()
    }
    pub fn executor() -> Pubkey {
        "6doghB248px58JSSwG4qejQ46kFMW4AMj7vzJnWZHNZn".parse().unwrap()
    }
    pub fn pricefeed() -> Pubkey {
        "8ahPGPjEbpgGaZx2NV1iG5Shj7TDwvsjkEDcGWjt94TP".parse().unwrap()
    }

    #[derive(BorshSerialize)]
    pub struct UlnSettings {
        pub eid: u32,
        pub endpoint: Pubkey,
        pub endpoint_program: Pubkey,
        pub bump: u8,
        pub admin: Pubkey,
        /// Always `None` here: a treasury would add a fee the second hop's zero `native_fee`
        /// cannot cover.
        pub treasury: Option<Treasury>,
    }

    #[derive(BorshSerialize)]
    pub struct Treasury {
        pub admin: Option<Pubkey>,
        pub native_receiver: Pubkey,
        pub native_fee_bps: u64,
        pub lz_token: Option<LzTokenTreasury>,
    }

    #[derive(BorshSerialize)]
    pub struct LzTokenTreasury {
        pub receiver: Pubkey,
        pub fee: u64,
    }

    #[derive(BorshSerialize)]
    pub struct SendConfig {
        pub bump: u8,
        pub uln: UlnConfig,
        pub executor: ExecutorRef,
    }

    #[derive(BorshSerialize)]
    pub struct UlnConfig {
        pub confirmations: u64,
        pub required_dvn_count: u8,
        pub optional_dvn_count: u8,
        pub optional_dvn_threshold: u8,
        /// `DvnConfig` account addresses, not DVN program ids: the library reads each one's
        /// owner to find the program it quotes through.
        pub required_dvns: Vec<Pubkey>,
        pub optional_dvns: Vec<Pubkey>,
    }

    #[derive(BorshSerialize)]
    pub struct ExecutorRef {
        pub max_message_size: u32,
        pub executor: Pubkey,
    }

    #[derive(BorshSerialize)]
    pub struct DvnConfig {
        pub vid: u32,
        pub bump: u8,
        pub multisig: Multisig,
        pub acl: Acl,
        pub paused: bool,
        pub msglibs: Vec<Pubkey>,
        pub admins: Vec<Pubkey>,
        pub price_feed: Pubkey,
        pub dst_configs: Vec<DvnDstConfig>,
        pub default_multiplier_bps: u16,
    }

    #[derive(BorshSerialize)]
    pub struct Multisig {
        pub signers: Vec<[u8; 64]>,
        pub quorum: u8,
    }

    #[derive(BorshSerialize)]
    pub struct Acl {
        pub allow_list: Vec<Pubkey>,
        pub deny_list: Vec<Pubkey>,
    }

    #[derive(BorshSerialize)]
    pub struct DvnDstConfig {
        pub eid: u32,
        pub dst_gas: u32,
        pub multiplier_bps: Option<u16>,
        pub floor_margin_usd: Option<u128>,
    }

    #[derive(BorshSerialize)]
    pub struct ExecutorConfig {
        pub bump: u8,
        pub owner: Pubkey,
        pub acl: Acl,
        pub admins: Vec<Pubkey>,
        pub executors: Vec<Pubkey>,
        pub msglibs: Vec<Pubkey>,
        pub paused: bool,
        pub default_multiplier_bps: u16,
        pub price_feed: Pubkey,
        pub dst_configs: Vec<ExecutorDstConfig>,
    }

    #[derive(BorshSerialize)]
    pub struct ExecutorDstConfig {
        pub eid: u32,
        pub lz_receive_base_gas: u32,
        pub lz_compose_base_gas: u32,
        pub multiplier_bps: Option<u16>,
        pub floor_margin_usd: Option<u128>,
        pub native_drop_cap: u128,
    }

    #[derive(BorshSerialize)]
    pub struct PriceFeed {
        pub admin: Pubkey,
        pub updaters: Vec<Pubkey>,
        pub price_ratio_denominator: u128,
        pub arbitrum_compression_percent: u128,
        pub native_token_price_usd: Option<u128>,
        pub prices: Vec<Price>,
        pub bump: u8,
    }

    #[derive(BorshSerialize)]
    pub struct Price {
        pub eid: u32,
        pub price_ratio: u128,
        pub gas_price_in_unit: u64,
        pub gas_per_byte: u32,
        /// `None` is the ordinary cost model; the L2 variants exist so the layout stays honest.
        pub model_type: Option<ModelType>,
    }

    #[derive(BorshSerialize)]
    #[allow(dead_code)]
    pub enum ModelType {
        Arbitrum { gas_per_l2_tx: u64, gas_per_l1_calldata_byte: u32 },
        Optimism { l1_eid: u32 },
    }

    // Anchor's `sha256("account:<Name>")[..8]`, copied from the generated client rather than
    // recomputed: this crate has no sha256 dependency.
    impl UlnSettings {
        pub const DISCRIMINATOR: [u8; 8] = [226, 199, 100, 253, 38, 115, 167, 154];
    }
    impl SendConfig {
        pub const DISCRIMINATOR: [u8; 8] = [91, 221, 135, 137, 131, 199, 174, 25];
    }
    impl DvnConfig {
        pub const DISCRIMINATOR: [u8; 8] = [49, 81, 33, 98, 234, 168, 93, 73];
    }
    impl ExecutorConfig {
        pub const DISCRIMINATOR: [u8; 8] = [134, 17, 226, 24, 10, 173, 157, 78];
    }
    impl PriceFeed {
        pub const DISCRIMINATOR: [u8; 8] = [189, 103, 252, 23, 152, 35, 243, 156];
    }
}

/// Groups of the planned `lz_compose` account list, in the order the planner emits them.
/// Lengths come from the fixture's own layout doc
/// (`tests/programs/multihop_composer/src/instructions/lz_compose.rs:12`).
/// Where the planned send's transfer-hook groups start: composer fixed (5), compose clear (5),
/// then the send's fixed accounts.
const SEND_HOOKS_AT: usize = 10 + multihop_composer::instructions::send_accounts::SEND_FIXED_LEN;

fn report(label: &str, accounts: &[AccountMetaRef], payer: Pubkey, hooks: usize) -> usize {
    let groups: [(&str, usize); 5] = [
        ("composer fixed", 5),
        ("compose clear", 5),
        ("send fixed", SEND_HOOKS_AT - 10),
        ("send transfer hook", hooks),
        ("endpoint send", accounts.len() - SEND_HOOKS_AT - hooks),
    ];
    let resolve = |a: &AccountMetaRef| match a.pubkey {
        AddressLocator::Address(k) => host(k),
        AddressLocator::Payer => payer,
        _ => panic!("unexpected locator"),
    };
    let mut offset = 0;
    println!("\n{label}");
    println!("  {:<22} {:>5} {:>7}", "group", "raw", "unique");
    let mut seen = HashSet::new();
    for (name, len) in groups {
        let slice = &accounts[offset..offset + len];
        let fresh = slice.iter().filter(|a| seen.insert(resolve(a))).count();
        println!("  {name:<22} {len:>5} {fresh:>7}");
        offset += len;
    }
    let unique = seen.len();
    println!("  {:<22} {:>5} {:>7}", "plan total", accounts.len(), unique);
    println!("  {:<22} {:>5} {:>7}", "+ composer, bracket", "", 1 + EXECUTOR_BRACKET_ADDRESSES);
    println!(
        "  {:<22} {:>5} {:>7}  of {TRANSACTION_V1_ADDRESS_LIMIT}",
        "TRANSACTION",
        "",
        unique + 1 + EXECUTOR_BRACKET_ADDRESSES
    );
    unique + 1 + EXECUTOR_BRACKET_ADDRESSES
}

/// Anyone can queue a compose message through the Endpoint's `send_compose`, and `clear_compose`
/// only proves who queued it, so the composer acts only on messages its own OFT queued.
#[test]
fn multihop_compose_refuses_a_message_another_sender_queued() {
    let h = Harness::with_pb(false, true, true);
    let endpoint_accounts = h.send_endpoint_accounts(0);
    let tail = endpoint_accounts[10..]
        .iter()
        .map(|a| planned(a.pubkey, a.is_writable, a.is_signer))
        .collect();
    let (store, ata) = h.multihop_store(simple_library_id(), tail);
    h.credit(ata, 1_000);
    let plan = h.multihop_plan(store, ata, 1_000);
    let [oapp::lz_compose_types_v3::ComposeInstruction::LzCompose { accounts }] =
        &plan.instructions[..]
    else {
        panic!("a multihop plan is one instruction: no local account to prepare")
    };
    let mut compose = h.multihop_compose(store, accounts, 1_000);
    let mut params = h.multihop_params(store, 1_000);
    params.from = to_program_pubkey(&Pubkey::new_unique());
    compose.data = multihop_composer::instruction::LzCompose { params }.data();

    assert_eq!(
        h.run(&[compose]).program_result,
        failure(multihop_composer::ComposerError::UntrustedSender)
    );
    assert_eq!(h.token(ata).amount, 1_000, "a refused compose moves nothing");
}

/// A composer that re-sends must fit the OFT's *entire* send account set — fixed struct, both
/// transfer-hook groups, the Endpoint's ten and the send library's tail — into the same
/// Transaction V1 as the compose clear. The plan is the measurement: whatever
/// `lz_compose_types_v3` emits is what the Executor submits.
#[test]
fn multihop_compose_then_send_plan_fits_transaction_v1() {
    let h = Harness::with_pb(false, true, true);
    let payer = h.f.payer;
    // Seeds the Endpoint's send-library state and hands back the very account list the
    // executable send test uses, so the plan's endpoint group can be checked against it.
    let endpoint_accounts = h.send_endpoint_accounts(0);
    let simple_tail: Vec<_> = endpoint_accounts[10..]
        .iter()
        .map(|a| planned(a.pubkey, a.is_writable, a.is_signer))
        .collect();
    let uln_program = Pubkey::new_unique();

    // pubkey_policy_hook resolves five extras behind the hook program and its manifest, and
    // `send` runs one such group per transfer: always source -> escrow, plus escrow ->
    // fee_deposit when the OFT charges a fee.
    const HOOK_GROUP: usize = 7;
    // The heaviest supported shapes: PB, the policy hook on both transfers, and up to four DVNs.
    // The report prints each group's contribution so headroom is visible when this moves.
    for (label, library, tail, fee_bps) in [
        ("SimpleMessageLib, no fee", simple_library_id(), simple_tail.clone(), 0u16),
        ("ULN302, 2 DVNs, with fee", uln_program, uln_tail(uln_program, 2), 1_000),
        ("ULN302, 4 DVNs, with fee", uln_program, uln_tail(uln_program, 4), 1_000),
    ] {
        h.set_default_fee_bps(fee_bps);
        let hooks = if fee_bps > 0 { 2 * HOOK_GROUP } else { HOOK_GROUP };
        let (store, ata) = h.multihop_store(library, tail);
        let plan = h.multihop_plan(store, ata, 1_000);
        let [oapp::lz_compose_types_v3::ComposeInstruction::LzCompose { accounts }] =
            &plan.instructions[..]
        else {
            panic!("a multihop plan is one instruction: no local account to prepare")
        };
        assert_eq!(
            h.planned_send_keys(accounts),
            h.expected_send_keys(store, ata),
            "{label}: the plan's send group must match Anchor's own account order"
        );
        if library == simple_library_id() {
            // The planner derives the Endpoint's ten from PDAs and the peer's address rather
            // than being handed them, so check the whole group against the list the executable
            // send test builds. A wrong nonce or message-library PDA would otherwise only show
            // up as a plausible-looking count.
            assert_eq!(h.metas(&accounts[SEND_HOOKS_AT + hooks..]), endpoint_accounts);
        }
        let total = report(label, accounts, payer, hooks);
        assert!(
            total <= TRANSACTION_V1_ADDRESS_LIMIT,
            "{label}: {total} addresses exceeds Transaction V1's {TRANSACTION_V1_ADDRESS_LIMIT}"
        );
    }
}

/// Mainnet's nesting limit, `MAX_INSTRUCTION_STACK_DEPTH`
/// (`solana-program-runtime-3.1.12/src/execution_budget.rs:8`).
const MAINNET_CPI_STACK_DEPTH: usize = 5;

/// The second hop's `send` is correct in every respect except one: it needs a sixth CPI frame.
///
/// A *direct* `console_oft::send` already fills all five mainnet allows — `send`(1),
/// `endpoint::send`(2), `uln::send`(3), the worker quote(4), `pricefeed::get_fee`(5). Running
/// that same send from a composer puts `lz_compose` at height 1 and pushes the price feed to 6.
///
/// SIMD-0268 ("Increase the maximum number of nested CPI calls") raises the ceiling to 9
/// (`MAX_INSTRUCTION_STACK_DEPTH_SIMD_0268`, `execution_budget.rs:10`) — four more than this
/// needs. It is Accepted but **not activated**: the runtime still gates it on the
/// `raise_cpi_nesting_limit_to_8` feature (`invoke_context.rs:788`). The passing half of this
/// test therefore previews an accepted protocol change. It is not something that works on
/// mainnet today; the failing half is what mainnet does.
///
/// Mollusk's own default is already the raised depth
/// (`ComputeBudget::new_with_defaults(/* simd_0268 */ true, true)`,
/// `mollusk-svm-0.12.0/src/lib.rs:719`), so the mainnet half has to lower it explicitly.
///
/// The library has to be the real ULN302: `SimpleMessageLib` has no worker fan-out, bottoms out
/// at height 4, and would pass at either depth while proving nothing.
#[test]
fn multihop_send_is_correct_but_needs_simd_0268_cpi_depth() {
    let mut h = Harness::with_pb(false, true, true);
    h.verify();
    h.set_default_fee_bps(1_000); // the hop sweeps an OFT fee, so `send` runs both hook groups
    let tail = h.install_uln();
    let (store, ata) = h.multihop_store(uln302::uln(), tail);
    h.credit(ata, 1_000);
    h.seed_compose_state(store, 1_000);
    let plan = h.multihop_plan(store, ata, 1_000);
    let [oapp::lz_compose_types_v3::ComposeInstruction::LzCompose { accounts }] =
        &plan.instructions[..]
    else {
        panic!("a multihop plan is one instruction: no local account to prepare")
    };
    let compose = [h.multihop_compose(store, accounts, 1_000)];

    h.f.context.mollusk.compute_budget.max_instruction_stack_depth = MAINNET_CPI_STACK_DEPTH;
    let refused = h.run(&compose);
    assert!(
        matches!(
            refused.program_result,
            TransactionProgramResult::UnknownError(0, InstructionError::CallDepth)
        ),
        "at mainnet depth the price-feed frame must be refused, and refused for depth: {:?}",
        refused.program_result
    );

    h.f.context.mollusk.compute_budget.max_instruction_stack_depth = MAINNET_CPI_STACK_DEPTH + 1;
    let result = h.run(&compose);
    assert!(result.program_result.is_ok(), "{:?}", result.program_result);

    // Depth is only the blocker if the chain really reaches the price feed. Both workers the
    // library fans out to quote through it, one frame below themselves.
    let keys = result.message.as_ref().unwrap().account_keys();
    let heights = |program: Pubkey| {
        result
            .inner_instructions
            .iter()
            .flatten()
            .filter(|inner| keys[usize::from(inner.instruction.program_id_index)] == program)
            .map(|inner| inner.stack_height)
            .collect::<Vec<_>>()
    };
    assert_eq!(heights(uln302::uln()), vec![Some(4), Some(5)], "send, then its own event CPI");
    assert_eq!(heights(uln302::executor()), vec![Some(5)]);
    assert_eq!(heights(uln302::dvn()), vec![Some(5)]);
    assert_eq!(heights(uln302::pricefeed()), vec![Some(6), Some(6)]);

    // The hop moved the composer's whole credit: 10% swept as the OFT fee, the rest burnt.
    assert_eq!(h.token(ata).amount, 0);
    assert_eq!(h.token(h.f.fee_deposit).amount, 100);
    assert_eq!(h.token(h.f.oft_escrow).amount, 0);
}
