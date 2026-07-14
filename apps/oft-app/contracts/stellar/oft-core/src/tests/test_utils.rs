//! Shared test utilities for OFT unit tests.
//!
//! This module provides common test contracts and helpers used across multiple test files.

use crate::{
    codec::oft_msg_codec::OFTMessage,
    oft_core::OFTClient,
    types::{OFTReceipt, SendParam},
};
use endpoint_v2::{LayerZeroReceiverClient, MessagingFee, MessagingParams, MessagingReceipt, Origin};
use oapp::oapp_core::OAppCoreClient;
use soroban_sdk::{
    address_payload::AddressPayload,
    bytes, contract, contractimpl, log, symbol_short,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    Address, Bytes, BytesN, Env, IntoVal, String, Symbol,
};

// ==================== Constants ====================

/// Default shared decimals used for cross-chain normalization in tests
pub const DEFAULT_SHARED_DECIMALS: u32 = 6;

// ==================== Helper Functions ====================

/// Create a SendParam for testing with default options.
pub fn create_send_param(env: &Env, dst_eid: u32, amount_ld: i128, min_amount_ld: i128) -> SendParam {
    SendParam {
        dst_eid,
        to: BytesN::from_array(env, &[1u8; 32]),
        amount_ld,
        min_amount_ld,
        extra_options: bytes!(env),
        compose_msg: bytes!(env),
        oft_cmd: bytes!(env),
    }
}

/// Creates a valid recipient address by deploying a dummy contract.
/// Use this in tests when the address needs to pass the `.exists()` check.
pub fn create_recipient_address(env: &Env) -> Address {
    env.register(DummyRecipient, ())
}

/// Creates a G-address (account address) from a 32-byte Ed25519 public key.
/// This is useful for testing with account addresses instead of contract addresses.
pub fn create_g_address(env: &Env, public_key: &BytesN<32>) -> Address {
    Address::from_payload(env, AddressPayload::AccountIdPublicKeyEd25519(public_key.clone()))
}

/// Generates a unique G-address (account address) for testing.
/// Each call generates a different address by using a counter-based approach.
pub fn generate_g_address(env: &Env) -> Address {
    // Use Address::generate which creates a unique address each time
    // Then convert it to ensure it's a G-address (account address)
    let addr = Address::generate(env);
    // Extract the payload - if it's already a G-address, use it; otherwise convert
    match addr.to_payload() {
        Some(AddressPayload::AccountIdPublicKeyEd25519(_pk)) => {
            // Already a G-address, return as-is
            addr
        }
        Some(AddressPayload::ContractIdHash(hash)) => {
            // It's a contract address, convert hash to G-address
            // Use the hash bytes as the Ed25519 public key
            create_g_address(env, &hash)
        }
        None => {
            // Fallback: create from hash bytes
            let hash = BytesN::from_array(env, &[0u8; 32]);
            create_g_address(env, &hash)
        }
    }
}

pub fn encode_oft_message(env: &Env, send_to: &BytesN<32>, amount_sd: u64) -> Bytes {
    let msg = OFTMessage { send_to: send_to.clone(), amount_sd, compose: None };
    msg.encode(env)
}

pub fn encode_oft_message_with_compose(
    env: &Env,
    send_to: &BytesN<32>,
    amount_sd: u64,
    compose_from: &BytesN<32>,
    compose_msg: &Bytes,
) -> Bytes {
    use crate::codec::oft_msg_codec::ComposeData;
    let msg = OFTMessage {
        send_to: send_to.clone(),
        amount_sd,
        compose: Some(ComposeData { from: compose_from.clone(), msg: compose_msg.clone() }),
    };
    msg.encode(env)
}

pub fn create_origin(src_eid: u32, sender: &BytesN<32>, nonce: u64) -> Origin {
    Origin { src_eid, sender: sender.clone(), nonce }
}

// ==================== Test OFT Contracts ====================

mod test_mint_burn_oft {
    use crate::{
        self as oft_core,
        oft_core::{OFTCore, OFTInternal},
    };
    use endpoint_v2::Origin;
    use oapp::oapp_receiver::LzReceiveInternal;
    use soroban_sdk::{contractclient, contractimpl, Address, Bytes, BytesN, Env};

    #[contractclient(name = "MintBurnTokenClient")]
    #[allow(dead_code)]
    trait MintBurnToken {
        fn mint(env: Env, to: Address, amount: i128);
        fn burn(env: Env, from: Address, amount: i128);
    }

    #[oapp_macros::oapp]
    #[common_macros::lz_contract]
    pub struct TestMintBurnOFT;

    #[contractimpl]
    impl TestMintBurnOFT {
        pub fn __constructor(
            env: &Env,
            token: &Address,
            owner: &Address,
            endpoint: &Address,
            delegate: &Address,
            shared_decimals: u32,
        ) {
            Self::__initialize_oft(env, token, shared_decimals, owner, endpoint, delegate)
        }
    }

    #[contractimpl(contracttrait)]
    impl OFTCore for TestMintBurnOFT {}

    impl LzReceiveInternal for TestMintBurnOFT {
        fn __lz_receive(
            env: &Env,
            origin: &Origin,
            guid: &BytesN<32>,
            message: &Bytes,
            extra_data: &Bytes,
            executor: &Address,
            value: i128,
        ) {
            <Self as OFTInternal>::__receive(env, origin, guid, message, extra_data, executor, value)
        }
    }

    impl OFTInternal for TestMintBurnOFT {
        fn __debit(env: &Env, sender: &Address, amount_ld: i128, min_amount_ld: i128, dst_eid: u32) -> (i128, i128) {
            // Inline mint_burn::debit implementation
            let (amount_sent_ld, amount_received_ld) = Self::__debit_view(env, amount_ld, min_amount_ld, dst_eid);
            MintBurnTokenClient::new(env, &Self::token(env)).burn(sender, &amount_received_ld);
            (amount_sent_ld, amount_received_ld)
        }

        fn __credit(env: &Env, to: &Address, amount_ld: i128, _src_eid: u32) -> i128 {
            // Inline mint_burn::credit implementation
            MintBurnTokenClient::new(env, &Self::token(env)).mint(to, &amount_ld);
            amount_ld
        }
    }
}
pub use test_mint_burn_oft::TestMintBurnOFT;

mod test_lock_unlock_oft {
    use crate::{
        self as oft_core,
        oft_core::{OFTCore, OFTInternal},
    };
    use endpoint_v2::Origin;
    use oapp::oapp_receiver::{LzReceiveInternal, OAppReceiver};
    use soroban_sdk::{contractimpl, token::TokenClient, Address, Bytes, BytesN, Env};

    #[oapp_macros::oapp(custom = [receiver])]
    #[common_macros::lz_contract]
    pub struct TestLockUnlockOFT;

    #[contractimpl]
    impl TestLockUnlockOFT {
        pub fn __constructor(
            env: &Env,
            token: &Address,
            owner: &Address,
            endpoint: &Address,
            delegate: &Address,
            shared_decimals: u32,
        ) {
            Self::__initialize_oft(env, token, shared_decimals, owner, endpoint, delegate)
        }
    }

    #[contractimpl(contracttrait)]
    impl OFTCore for TestLockUnlockOFT {}

    impl LzReceiveInternal for TestLockUnlockOFT {
        fn __lz_receive(
            env: &Env,
            origin: &Origin,
            guid: &BytesN<32>,
            message: &Bytes,
            extra_data: &Bytes,
            executor: &Address,
            value: i128,
        ) {
            <Self as OFTInternal>::__receive(env, origin, guid, message, extra_data, executor, value)
        }
    }

    // Custom receiver to demonstrate overriding next_nonce or other methods
    #[contractimpl(contracttrait)]
    impl OAppReceiver for TestLockUnlockOFT {}

    impl OFTInternal for TestLockUnlockOFT {
        fn __debit(env: &Env, sender: &Address, amount_ld: i128, min_amount_ld: i128, dst_eid: u32) -> (i128, i128) {
            // Inline lock_unlock::debit implementation
            let (amount_sent_ld, amount_received_ld) = Self::__debit_view(env, amount_ld, min_amount_ld, dst_eid);
            TokenClient::new(env, &Self::token(env)).transfer(
                sender,
                env.current_contract_address(),
                &amount_received_ld,
            );
            (amount_sent_ld, amount_received_ld)
        }

        fn __credit(env: &Env, to: &Address, amount_ld: i128, _src_eid: u32) -> i128 {
            // Inline lock_unlock::credit implementation
            TokenClient::new(env, &Self::token(env)).transfer(&env.current_contract_address(), to, &amount_ld);
            amount_ld
        }
    }
}
pub use test_lock_unlock_oft::TestLockUnlockOFT;

// ==================== Dummy Contracts ====================

/// Dummy recipient contract for testing - used to create valid contract addresses
#[contract]
pub struct DummyRecipient;

#[contractimpl]
impl DummyRecipient {
    pub fn __constructor(_env: &Env) {}
}

/// Simple token contract for testing (replaces OpenZeppelin dependency)
#[contract]
pub struct DummyToken;

#[contractimpl]
impl DummyToken {
    fn admin(env: &Env) -> Address {
        env.storage().instance().get(&symbol_short!("admin")).unwrap()
    }

    fn get_balance(env: &Env, addr: &Address) -> i128 {
        env.storage().persistent().get(&addr).unwrap_or(0)
    }

    fn set_balance(env: &Env, addr: &Address, amount: i128) {
        env.storage().persistent().set(&addr, &amount);
    }

    pub fn __constructor(env: &Env, owner: Address, decimals: u32) {
        env.storage().instance().set(&symbol_short!("admin"), &owner);
        env.storage().instance().set(&symbol_short!("decimal"), &decimals);
        env.storage().instance().set(&symbol_short!("name"), &String::from_str(env, "DummyToken"));
        env.storage().instance().set(&symbol_short!("symbol"), &String::from_str(env, "DUMMY"));
    }

    // keep the same behavior as SAC that requires admin's authorization
    pub fn set_admin(env: &Env, admin: &Address) {
        Self::admin(env).require_auth();
        env.storage().instance().set(&symbol_short!("admin"), &admin);
    }

    pub fn mint(env: &Env, to: &Address, amount: i128) {
        Self::admin(env).require_auth();
        if amount < 0 {
            panic!("negative amount");
        }
        let balance = Self::get_balance(env, to);
        Self::set_balance(env, to, balance + amount);
        log!(&env, "minted {} to {}", amount, to);
    }

    // keep the same behavior as SAC that requires from's authorization
    pub fn burn(env: &Env, from: &Address, amount: i128) {
        from.require_auth();
        if amount < 0 {
            panic!("negative amount");
        }
        let balance = Self::get_balance(env, from);
        if balance < amount {
            panic!("insufficient balance");
        }
        Self::set_balance(env, from, balance - amount);
        log!(&env, "burned {} from {}", amount, from);
    }

    pub fn balance(env: &Env, id: Address) -> i128 {
        Self::get_balance(env, &id)
    }

    pub fn transfer(env: &Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        if amount < 0 {
            panic!("negative amount");
        }
        let from_balance = Self::get_balance(env, &from);
        if from_balance < amount {
            panic!("insufficient balance");
        }
        Self::set_balance(env, &from, from_balance - amount);
        let to_balance = Self::get_balance(env, &to);
        Self::set_balance(env, &to, to_balance + amount);
    }

    pub fn decimals(env: &Env) -> u32 {
        env.storage().instance().get(&symbol_short!("decimal")).unwrap_or(7)
    }

    pub fn name(env: &Env) -> String {
        env.storage().instance().get(&symbol_short!("name")).unwrap()
    }

    pub fn symbol(env: &Env) -> String {
        env.storage().instance().get(&symbol_short!("symbol")).unwrap()
    }
}

// ==================== Mock Endpoint ====================

/// A comprehensive mock endpoint contract for testing OFT functionality.
/// Supports: quote, set_delegate, clear, send_compose, and compose verification.
#[contract]
pub struct MockEndpointWithCompose;

#[contractimpl]
impl MockEndpointWithCompose {
    pub fn __constructor(env: Env, native_fee: i128, zro_fee: i128, native_token: Address, zro_token: Address) {
        env.storage().instance().set(&symbol_short!("ntv_fee"), &native_fee);
        env.storage().instance().set(&symbol_short!("zro_fee"), &zro_fee);
        env.storage().instance().set(&symbol_short!("ntk"), &native_token);
        env.storage().instance().set(&symbol_short!("zro"), &zro_token);
    }

    /// Returns the native token address (required by OAppSenderInternal)
    pub fn native_token(env: Env) -> Address {
        env.storage().instance().get(&symbol_short!("ntk")).unwrap()
    }

    /// Returns the ZRO token address (required by OAppSenderInternal)
    pub fn zro(env: Env) -> Option<Address> {
        env.storage().instance().get(&symbol_short!("zro"))
    }

    /// Required by OApp initialization to set delegate
    pub fn set_delegate(_env: Env, _oapp: Address, _delegate: Option<Address>) {
        // No-op for testing
    }

    /// Required by OAppReceiver.lz_receive to clear the payload
    pub fn clear(_env: Env, _oapp: Address, _origin: Origin, _receiver: Address, _guid: BytesN<32>, _message: Bytes) {
        // No-op for testing
    }

    /// Required by quote_send to get messaging fees
    pub fn quote(env: Env, _sender: Address, params: MessagingParams) -> MessagingFee {
        let native_fee: i128 = env.storage().instance().get(&symbol_short!("ntv_fee")).unwrap_or(1000);
        let zro_fee: i128 =
            if params.pay_in_zro { env.storage().instance().get(&symbol_short!("zro_fee")).unwrap_or(500) } else { 0 };
        MessagingFee { native_fee, zro_fee }
    }

    /// Required by send to send cross-chain messages
    pub fn send(env: Env, _sender: Address, params: MessagingParams, _refund_address: Address) -> MessagingReceipt {
        // Increment nonce for each send
        let nonce: u64 = env.storage().instance().get(&symbol_short!("nonce")).unwrap_or(0) + 1;
        env.storage().instance().set(&symbol_short!("nonce"), &nonce);

        // Store send details for verification
        env.storage().instance().set(&symbol_short!("sent"), &true);
        env.storage().instance().set(&Symbol::new(&env, "last_dst_eid"), &params.dst_eid);
        env.storage().instance().set(&Symbol::new(&env, "last_msg"), &params.message);

        let native_fee: i128 = env.storage().instance().get(&symbol_short!("ntv_fee")).unwrap_or(1000);
        let zro_fee: i128 =
            if params.pay_in_zro { env.storage().instance().get(&symbol_short!("zro_fee")).unwrap_or(500) } else { 0 };

        MessagingReceipt {
            guid: BytesN::from_array(&env, &[nonce as u8; 32]),
            nonce,
            fee: MessagingFee { native_fee, zro_fee },
        }
    }

    /// Helper to check if send was called
    pub fn was_sent(env: Env) -> bool {
        env.storage().instance().get(&symbol_short!("sent")).unwrap_or(false)
    }

    /// Get the last destination EID that was sent to
    pub fn get_last_dst_eid(env: Env) -> Option<u32> {
        env.storage().instance().get(&Symbol::new(&env, "last_dst_eid"))
    }

    /// Get the current nonce
    pub fn get_nonce(env: Env) -> u64 {
        env.storage().instance().get(&symbol_short!("nonce")).unwrap_or(0)
    }

    /// Implements the send_compose method from MessagingComposer
    pub fn send_compose(env: Env, from: Address, to: Address, guid: BytesN<32>, index: u32, message: Bytes) {
        env.storage().instance().set(&symbol_short!("composed"), &true);
        env.storage().instance().set(&Symbol::new(&env, "compose_from"), &from);
        env.storage().instance().set(&Symbol::new(&env, "compose_to"), &to);
        env.storage().instance().set(&Symbol::new(&env, "compose_guid"), &guid);
        env.storage().instance().set(&Symbol::new(&env, "compose_idx"), &index);
        env.storage().instance().set(&Symbol::new(&env, "compose_msg"), &message);
    }

    /// Helper to check if compose was called
    pub fn was_composed(env: Env) -> bool {
        env.storage().instance().get(&symbol_short!("composed")).unwrap_or(false)
    }

    pub fn get_compose_to(env: Env) -> Option<Address> {
        env.storage().instance().get(&Symbol::new(&env, "compose_to"))
    }

    #[allow(dead_code)]
    pub fn get_compose_msg(env: Env) -> Option<Bytes> {
        env.storage().instance().get(&Symbol::new(&env, "compose_msg"))
    }
}

// ==================== Test Setup ====================

/// Default fees for mock endpoint
pub const DEFAULT_NATIVE_FEE: i128 = 1000;
pub const DEFAULT_ZRO_FEE: i128 = 500;
/// Large amount for pre-minting tokens during setup
pub const INITIAL_MINT_AMOUNT: i128 = 1_000_000_000_000_000_000;

/// OFT strategy type for test setup
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum OFTType {
    #[default]
    MintBurn,
    LockUnlock,
}

/// Token type for test setup
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum TokenType {
    SAC, // Stellar Asset Contract (native, 7 decimals)
    #[default]
    ContractToken, // Custom contract token (configurable decimals)
}

pub struct OFTTestSetup<'a> {
    pub env: &'a Env,
    pub oft: OFTClient<'a>,
    pub endpoint_client: MockEndpointWithComposeClient<'a>,
    pub token: Address,
    pub token_client: TokenClient<'a>,
    pub native_token: Address,
    pub zro_token: Address,
    pub owner: Address,
    pub native_fee: i128,
    pub zro_fee: i128,
    pub oft_type: OFTType,
    pub token_decimals: u32,
    pub shared_decimals: u32,
    pub issuer: Address,
}

/// Builder for OFTTestSetup
pub struct OFTTestSetupBuilder<'a> {
    env: &'a Env,
    native_fee: i128,
    zro_fee: i128,
    oft_type: OFTType,
    token_type: TokenType,
    token_decimals: u32,
    shared_decimals: u32,
}

impl<'a> OFTTestSetupBuilder<'a> {
    pub fn new(env: &'a Env) -> Self {
        Self {
            env,
            native_fee: DEFAULT_NATIVE_FEE,
            zro_fee: DEFAULT_ZRO_FEE,
            oft_type: OFTType::default(),
            token_type: TokenType::default(),
            token_decimals: 7,
            shared_decimals: DEFAULT_SHARED_DECIMALS,
        }
    }

    pub fn with_token_decimals(mut self, decimals: u32) -> Self {
        self.token_decimals = decimals;
        // Automatically use ContractToken if custom decimals are requested (SAC is fixed at 7)
        if decimals != 7 {
            self.token_type = TokenType::ContractToken;
        }
        self
    }

    pub fn with_shared_decimals(mut self, decimals: u32) -> Self {
        self.shared_decimals = decimals;
        self
    }

    pub fn with_fees(mut self, native_fee: i128, zro_fee: i128) -> Self {
        self.native_fee = native_fee;
        self.zro_fee = zro_fee;
        self
    }

    pub fn with_native_fee(mut self, native_fee: i128) -> Self {
        self.native_fee = native_fee;
        self
    }

    pub fn with_zro_fee(mut self, zro_fee: i128) -> Self {
        self.zro_fee = zro_fee;
        self
    }

    pub fn lock_unlock(mut self) -> Self {
        self.oft_type = OFTType::LockUnlock;
        self
    }

    pub fn with_sac(mut self) -> Self {
        self.token_type = TokenType::SAC;
        self.token_decimals = 7; // SAC has fixed 7 decimals
        self
    }

    pub fn build(self) -> OFTTestSetup<'a> {
        let env = self.env;
        let native_fee = self.native_fee;
        let zro_fee = self.zro_fee;
        let oft_type = self.oft_type;

        let owner = create_recipient_address(env);

        // Create native token for fees
        let native_sac = env.register_stellar_asset_contract_v2(owner.clone());
        let native_token = native_sac.address();

        // Create ZRO token
        let zro_sac = env.register_stellar_asset_contract_v2(owner.clone());
        let zro_token = zro_sac.address();

        // Create OFT token based on token_type
        let (token, actual_token_decimals, issuer) = match self.token_type {
            TokenType::SAC => {
                let sac = env.register_stellar_asset_contract_v2(owner.clone());
                (sac.address(), 7u32, sac.issuer().address()) // SAC has fixed 7 decimals
            }
            TokenType::ContractToken => {
                let token = env.register(DummyToken, (&owner, self.token_decimals));
                (token, self.token_decimals, owner.clone())
            }
        };
        let token_client = TokenClient::new(env, &token);

        // Register mock endpoint
        let endpoint_address =
            env.register(MockEndpointWithCompose, (&native_fee, &zro_fee, &native_token, &zro_token));
        let endpoint_client = MockEndpointWithComposeClient::new(env, &endpoint_address);

        // Register OFT based on type
        let delegate = owner.clone();
        let oft_address = match oft_type {
            OFTType::MintBurn => {
                env.register(TestMintBurnOFT, (&token, &owner, &endpoint_address, &delegate, &self.shared_decimals))
            }
            OFTType::LockUnlock => {
                env.register(TestLockUnlockOFT, (&token, &owner, &endpoint_address, &delegate, &self.shared_decimals))
            }
        };
        let oft = OFTClient::new(env, &oft_address);

        // Pre-mint large amounts to owner
        OFTTestSetup::mint_to(env, &owner, &token, &owner, INITIAL_MINT_AMOUNT);
        OFTTestSetup::mint_to(env, &owner, &native_token, &owner, INITIAL_MINT_AMOUNT);
        OFTTestSetup::mint_to(env, &owner, &zro_token, &owner, INITIAL_MINT_AMOUNT);

        // Setup based on OFT type
        match oft_type {
            OFTType::MintBurn => {
                // Transfer token ownership to OFT so it can burn tokens
                OFTTestSetup::transfer_token_ownership(env, &owner, &token, &oft_address);
            }
            OFTType::LockUnlock => {
                // Fund the OFT with tokens so it can unlock/release them on receive
                OFTTestSetup::mint_to(env, &owner, &token, &oft_address, INITIAL_MINT_AMOUNT);
            }
        }

        log!(&env, "token decimals: {}", self.token_decimals);
        log!(&env, "token address: {}", token);
        log!(&env, "token client: {}", token_client.address);
        log!(&env, "native token address: {}", native_token);
        log!(&env, "zro token address: {}", zro_token);
        log!(&env, "owner: {}", owner);
        log!(&env, "native fee: {}", native_fee);
        log!(&env, "zro fee: {}", zro_fee);
        log!(&env, "oft address: {}", oft_address);

        OFTTestSetup {
            env,
            oft,
            endpoint_client,
            token,
            token_client,
            native_token,
            zro_token,
            owner,
            native_fee,
            zro_fee,
            oft_type,
            token_decimals: actual_token_decimals,
            shared_decimals: self.shared_decimals,
            issuer,
        }
    }
}

impl<'a> OFTTestSetup<'a> {
    /// Create a new test setup with default configuration (MintBurn OFT)
    pub fn new(env: &'a Env) -> Self {
        OFTTestSetupBuilder::new(env).build()
    }

    /// Returns true if this setup uses a LockUnlock OFT
    pub fn is_lock_unlock(&self) -> bool {
        self.oft_type == OFTType::LockUnlock
    }

    pub fn set_peer(&self, eid: u32, peer: &BytesN<32>) {
        let peer_option = Some(peer.clone());
        self.env.mock_auths(&[MockAuth {
            address: &self.owner,
            invoke: &MockAuthInvoke {
                contract: &self.oft.address,
                fn_name: "set_peer",
                args: (&eid, &peer_option, &self.owner).into_val(self.env),
                sub_invokes: &[],
            },
        }]);
        OAppCoreClient::new(self.env, &self.oft.address).set_peer(&eid, &peer_option, &self.owner);
    }

    pub fn mint_to(env: &Env, owner: &Address, token: &Address, to: &Address, amount: i128) {
        env.mock_auths(&[MockAuth {
            address: owner,
            invoke: &MockAuthInvoke {
                contract: token,
                fn_name: "mint",
                args: (to, amount).into_val(env),
                sub_invokes: &[],
            },
        }]);
        StellarAssetClient::new(env, token).mint(to, &amount);
    }

    pub fn transfer_token_ownership(env: &Env, owner: &Address, token: &Address, new_admin: &Address) {
        env.mock_auths(&[MockAuth {
            address: owner,
            invoke: &MockAuthInvoke {
                contract: token,
                fn_name: "set_admin",
                args: (new_admin,).into_val(env),
                sub_invokes: &[],
            },
        }]);
        StellarAssetClient::new(env, token).set_admin(new_admin);
    }

    /// Fund an account with native fees only (transfers from owner)
    pub fn fund_native_fees(&self, to: &Address, amount: i128) {
        self.env.mock_auths(&[MockAuth {
            address: &self.owner,
            invoke: &MockAuthInvoke {
                contract: &self.native_token,
                fn_name: "transfer",
                args: (&self.owner, to, amount).into_val(self.env),
                sub_invokes: &[],
            },
        }]);
        TokenClient::new(self.env, &self.native_token).transfer(&self.owner, to, &amount);
    }

    /// Fund an account with ZRO fees (transfers from owner)
    pub fn fund_zro_fees(&self, to: &Address, amount: i128) {
        self.env.mock_auths(&[MockAuth {
            address: &self.owner,
            invoke: &MockAuthInvoke {
                contract: &self.zro_token,
                fn_name: "transfer",
                args: (&self.owner, to, amount).into_val(self.env),
                sub_invokes: &[],
            },
        }]);
        TokenClient::new(self.env, &self.zro_token).transfer(&self.owner, to, &amount);
    }

    /// Fund an account with OFT tokens only (transfers from owner)
    pub fn fund_tokens(&self, to: &Address, amount: i128) {
        self.env.mock_auths(&[MockAuth {
            address: &self.owner,
            invoke: &MockAuthInvoke {
                contract: &self.token,
                fn_name: "transfer",
                args: (&self.owner, to, amount).into_val(self.env),
                sub_invokes: &[],
            },
        }]);
        self.token_client.transfer(&self.owner, to, &amount);
    }

    /// Quote OFT to get the receipt for authorization
    pub fn quote_oft(&self, from: &Address, send_param: &SendParam) -> OFTReceipt {
        let (_, _, receipt) = self.oft.quote_oft(from, send_param);
        receipt
    }

    /// Send tokens cross-chain with proper sender authentication
    pub fn send(
        &self,
        sender: &Address,
        send_param: &SendParam,
        fee: &MessagingFee,
        refund_address: &Address,
        oft_receipt: &OFTReceipt,
    ) -> (MessagingReceipt, OFTReceipt) {
        // Token operation sub-invoke differs based on OFT type
        // Both MintBurn and LockUnlock use amount_received_ld (after fee/dust removal)
        let token_sub_invoke = match self.oft_type {
            OFTType::MintBurn => MockAuthInvoke {
                contract: &self.token,
                fn_name: "burn",
                args: (sender, &oft_receipt.amount_received_ld).into_val(self.env),
                sub_invokes: &[],
            },
            OFTType::LockUnlock => MockAuthInvoke {
                contract: &self.token,
                fn_name: "transfer",
                args: (sender, &self.oft.address, &oft_receipt.amount_received_ld).into_val(self.env),
                sub_invokes: &[],
            },
        };

        self.env.mock_auths(&[MockAuth {
            address: sender,
            invoke: &MockAuthInvoke {
                contract: &self.oft.address,
                fn_name: "send",
                args: (sender, send_param, fee, refund_address).into_val(self.env),
                sub_invokes: &[
                    MockAuthInvoke {
                        contract: &self.native_token,
                        fn_name: "transfer",
                        args: (sender, &self.endpoint_client.address, &fee.native_fee).into_val(self.env),
                        sub_invokes: &[],
                    },
                    MockAuthInvoke {
                        contract: &self.zro_token,
                        fn_name: "transfer",
                        args: (sender, &self.endpoint_client.address, &fee.zro_fee).into_val(self.env),
                        sub_invokes: &[],
                    },
                    token_sub_invoke,
                ],
            },
        }]);
        self.oft.send(sender, send_param, fee, refund_address)
    }

    /// Try send tokens cross-chain with proper sender authentication (returns Result)
    pub fn try_send(
        &self,
        sender: &Address,
        send_param: &SendParam,
        fee: &MessagingFee,
        refund_address: &Address,
        oft_receipt: &OFTReceipt,
    ) -> Result<
        Result<(MessagingReceipt, OFTReceipt), soroban_sdk::Error>,
        Result<soroban_sdk::Error, soroban_sdk::InvokeError>,
    > {
        // Token operation sub-invoke differs based on OFT type
        // Both MintBurn and LockUnlock use amount_received_ld (after fee/dust removal)
        let token_sub_invoke = match self.oft_type {
            OFTType::MintBurn => MockAuthInvoke {
                contract: &self.token,
                fn_name: "burn",
                args: (sender, &oft_receipt.amount_received_ld).into_val(self.env),
                sub_invokes: &[],
            },
            OFTType::LockUnlock => MockAuthInvoke {
                contract: &self.token,
                fn_name: "transfer",
                args: (sender, &self.oft.address, &oft_receipt.amount_received_ld).into_val(self.env),
                sub_invokes: &[],
            },
        };

        self.env.mock_auths(&[MockAuth {
            address: sender,
            invoke: &MockAuthInvoke {
                contract: &self.oft.address,
                fn_name: "send",
                args: (sender, send_param, fee, refund_address).into_val(self.env),
                sub_invokes: &[
                    MockAuthInvoke {
                        contract: &self.native_token,
                        fn_name: "transfer",
                        args: (sender, &self.endpoint_client.address, &fee.native_fee).into_val(self.env),
                        sub_invokes: &[],
                    },
                    MockAuthInvoke {
                        contract: &self.zro_token,
                        fn_name: "transfer",
                        args: (sender, &self.endpoint_client.address, &fee.zro_fee).into_val(self.env),
                        sub_invokes: &[],
                    },
                    token_sub_invoke,
                ],
            },
        }]);
        self.oft.try_send(sender, send_param, fee, refund_address)
    }

    /// Execute lz_receive with proper executor authentication
    pub fn lz_receive(
        &self,
        executor: &Address,
        origin: &Origin,
        guid: &BytesN<32>,
        message: &Bytes,
        extra_data: &Bytes,
        value: i128,
    ) {
        self.env.mock_auths(&[MockAuth {
            address: executor,
            invoke: &MockAuthInvoke {
                contract: &self.oft.address,
                fn_name: "lz_receive",
                args: (executor, origin, guid, message, extra_data, value).into_val(self.env),
                sub_invokes: &[],
            },
        }]);
        LayerZeroReceiverClient::new(self.env, &self.oft.address)
            .lz_receive(executor, origin, guid, message, extra_data, &value);
    }
}
