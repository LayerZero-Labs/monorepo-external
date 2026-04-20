extern crate std;

use crate::{
    counter::{Counter, CounterClient},
    integration_tests::{
        signing::{Ed25519KeyPair, Secp256k1KeyPair},
        utils::{address_to_bytes32, decode_packet, register_library, set_peer, set_zro, ChainSetupCommon},
    },
};
use dvn::{DVNClient, DstConfig as DvnDstConfig, DstConfigParam as DvnDstConfigParam, LzDVN};
use dvn_fee_lib::DvnFeeLib;
use endpoint_v2::{EndpointV2, EndpointV2Client};
use executor::{DstConfig as ExecutorDstConfig, ExecutorClient, LzExecutor, LzExecutorClient, SetDstConfigParam};
use executor_fee_lib::ExecutorFeeLib;
use executor_helper::{ExecutorHelper, ExecutorHelperClient};
use fee_lib_interfaces::Price;
use price_feed::{types::UpdatePrice, LzPriceFeed};
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token::TokenClient,
    vec, Address, BytesN, Env, IntoVal, Symbol, Vec,
};
use treasury::Treasury;
use uln302::{
    ExecutorConfig, ReceiveUln302Client, SendUln302Client, SetDefaultExecutorConfigParam, SetDefaultUlnConfigParam,
    Uln302, Uln302Client, UlnConfig,
};
use utils::{buffer_reader::BufferReader, buffer_writer::BufferWriter};

pub const CONFIRMATIONS: u64 = 1;
pub const MAX_MESSAGE_SIZE: u32 = 10000;
pub const DVN_VID: u32 = 1; // DVN Verifier ID

// Price feed constants for testing
const PRICE_RATIO_DENOMINATOR: u128 = 10_u128.pow(20);
const DEFAULT_GAS_PRICE: u64 = 100;
const DEFAULT_GAS_PER_BYTE: u32 = 1;
const DEFAULT_MULTIPLIER_BPS: u32 = 10000; // 100%

// Worker options constants
const OPTIONS_TYPE_3: u16 = 3;
const EXECUTOR_WORKER_ID: u8 = 1;
const EXECUTOR_OPTION_TYPE_LZRECEIVE: u8 = 1;

#[allow(dead_code)]
const EXECUTOR_OPTION_TYPE_NATIVE_DROP: u8 = 2;

const EXECUTOR_OPTION_TYPE_LZCOMPOSE: u8 = 3;

// ============================================================================
// Options Creation Functions
// ============================================================================

/// Creates default ULN302 options with Type 3 format and basic lzReceive gas (no lzCompose).
/// This is required because ULN302 expects at least 2 bytes for the options type header.
pub fn create_default_options(env: &Env) -> soroban_sdk::Bytes {
    create_options_with_gas(env, 100000, 0)
}

/// Extracts the executor value (native token amount) from Type 3 options.
/// Returns 0 if no value is specified in the options.
pub fn get_executor_value_from_options(_env: &Env, options: &soroban_sdk::Bytes) -> i128 {
    let mut reader = BufferReader::new(options);

    // Skip options type header (2 bytes)
    let _options_type = reader.read_u16();

    // Parse options until we find lzReceive with value
    while reader.remaining_len() > 0 {
        let _worker_id = reader.read_u8();
        let option_size = reader.read_u16();
        let option_type = reader.read_u8();

        if option_type == EXECUTOR_OPTION_TYPE_LZRECEIVE {
            // option_size includes option_type(1) + data
            // If data is 32 bytes (gas + value), extract value
            // If data is 16 bytes (gas only), value is 0
            let data_size = option_size - 1; // subtract option_type byte
            let _gas = reader.read_u128();
            if data_size == 32 {
                return reader.read_u128() as i128;
            }
            return 0;
        } else {
            // Skip this option's data (option_size - 1 for option_type already read)
            reader.skip((option_size - 1).into());
        }
    }

    0
}

/// Extracts the lzCompose value (native token amount) from Type 3 options.
/// Returns 0 if no lzCompose value is specified in the options.
pub fn get_compose_value_from_options(_env: &Env, options: &soroban_sdk::Bytes) -> i128 {
    let mut reader = BufferReader::new(options);

    // Skip options type header (2 bytes)
    let _options_type = reader.read_u16();

    // Parse options until we find lzCompose with value
    while reader.remaining_len() > 0 {
        let _worker_id = reader.read_u8();
        let option_size = reader.read_u16();
        let option_type = reader.read_u8();

        if option_type == EXECUTOR_OPTION_TYPE_LZCOMPOSE {
            // option_size includes option_type(1) + data
            // lzCompose format: [index: u16][gas: u128] (18 bytes) or [index: u16][gas: u128][value: u128] (34 bytes)
            // So data_size is 18 or 34
            let data_size = option_size - 1; // subtract option_type byte
            let _index = reader.read_u16();
            let _gas = reader.read_u128();
            if data_size == 34 {
                return reader.read_u128() as i128;
            }
            return 0;
        } else {
            // Skip this option's data (option_size - 1 for option_type already read)
            reader.skip((option_size - 1).into());
        }
    }

    0
}

/// Creates ULN302 options with lzReceive gas and optional lzCompose gas.
/// Format: [options_type(2)][lzReceive option][lzCompose option (if lz_compose_gas > 0)]
///
/// # Arguments
/// * `env` - Soroban environment
/// * `gas` - Gas limit for lzReceive execution (always required)
/// * `lz_compose_gas` - Gas limit for lzCompose execution (only added if > 0)
pub fn create_options_with_gas(env: &Env, gas: u128, lz_compose_gas: u128) -> soroban_sdk::Bytes {
    create_options_with_gas_and_value(env, gas, 0, lz_compose_gas, 0)
}

/// Creates ULN302 options with lzReceive gas/value and optional lzCompose gas/value.
/// Format: [options_type(2)][lzReceive option][lzCompose option (if lz_compose_gas > 0)]
///
/// # Arguments
/// * `env` - Soroban environment
/// * `gas` - Gas limit for lzReceive execution (always required)
/// * `value` - Native value for lzReceive (only added if > 0)
/// * `lz_compose_gas` - Gas limit for lzCompose execution (only added if > 0)
/// * `lz_compose_value` - Native value for lzCompose (only added if > 0)
pub fn create_options_with_gas_and_value(
    env: &Env,
    gas: u128,
    value: u128,
    lz_compose_gas: u128,
    lz_compose_value: u128,
) -> soroban_sdk::Bytes {
    let mut writer = BufferWriter::new(env);

    // Type 3 options header
    writer.write_u16(OPTIONS_TYPE_3);

    // Add lzReceive option - include value only if > 0
    if value > 0 {
        writer
            .write_u8(EXECUTOR_WORKER_ID) // worker_id (1 byte)
            .write_u16(33) // option_size: option_type(1) + gas(16) + value(16) = 33 bytes
            .write_u8(EXECUTOR_OPTION_TYPE_LZRECEIVE) // option_type (1 byte)
            .write_u128(gas) // execution gas (16 bytes)
            .write_u128(value); // value (16 bytes)
    } else {
        writer
            .write_u8(EXECUTOR_WORKER_ID) // worker_id (1 byte)
            .write_u16(17) // option_size: option_type(1) + gas(16) = 17 bytes
            .write_u8(EXECUTOR_OPTION_TYPE_LZRECEIVE) // option_type (1 byte)
            .write_u128(gas); // execution gas (16 bytes)
    }

    // Add lzCompose option only if lz_compose_gas > 0
    if lz_compose_gas > 0 {
        if lz_compose_value > 0 {
            // lzCompose with gas and value: [index: u16][gas: u128][value: u128] = 34 bytes
            writer
                .write_u8(EXECUTOR_WORKER_ID) // worker_id (1 byte)
                .write_u16(35) // option_size: option_type(1) + index(2) + gas(16) + value(16) = 35 bytes
                .write_u8(EXECUTOR_OPTION_TYPE_LZCOMPOSE) // option_type (1 byte)
                .write_u16(0) // compose index (2 bytes)
                .write_u128(lz_compose_gas) // compose gas (16 bytes)
                .write_u128(lz_compose_value); // compose value (16 bytes)
        } else {
            // lzCompose with gas only: [index: u16][gas: u128] = 18 bytes
            writer
                .write_u8(EXECUTOR_WORKER_ID) // worker_id (1 byte)
                .write_u16(19) // option_size: option_type(1) + index(2) + gas(16) = 19 bytes
                .write_u8(EXECUTOR_OPTION_TYPE_LZCOMPOSE) // option_type (1 byte)
                .write_u16(0) // compose index (2 bytes)
                .write_u128(lz_compose_gas); // compose gas (16 bytes)
        }
    }

    writer.to_bytes()
}

/// Creates ULN302 options with lzReceive gas and value (for ABA return messages).
/// Format: [options_type(2)][lzReceive option with gas and value]
pub fn create_aba_return_options(env: &Env) -> soroban_sdk::Bytes {
    let mut writer = BufferWriter::new(env);

    // Type 3 options header
    writer.write_u16(OPTIONS_TYPE_3);

    // Add lzReceive option with gas=200000 and value=10 (matching Counter's ABA return)
    writer
        .write_u8(EXECUTOR_WORKER_ID) // worker_id (1 byte)
        .write_u16(33) // option_size: option_type(1) + gas(16) + value(16) = 33 bytes
        .write_u8(EXECUTOR_OPTION_TYPE_LZRECEIVE) // option_type (1 byte)
        .write_u128(200000) // execution gas (16 bytes)
        .write_u128(10); // value (16 bytes)

    writer.to_bytes()
}

/// Creates ULN302 options for ComposedABA return (gas=200000, no lzCompose).
pub fn create_composed_aba_return_options(env: &Env) -> soroban_sdk::Bytes {
    create_options_with_gas(env, 200000, 0)
}

/// Creates ULN302 options with native drop included.
/// Format: [options_type(2)][lzReceive option][native drop option]
#[allow(dead_code)]
pub fn create_options_with_native_drop(env: &Env, amount: u128, receiver: &BytesN<32>) -> soroban_sdk::Bytes {
    let mut writer = BufferWriter::new(env);

    // Type 3 options header
    writer.write_u16(OPTIONS_TYPE_3);

    // Add a basic lzReceive option with default gas (100000)
    writer
        .write_u8(EXECUTOR_WORKER_ID) // worker_id (1 byte)
        .write_u16(17) // option_size: option_type(1) + data(16) = 17 bytes
        .write_u8(EXECUTOR_OPTION_TYPE_LZRECEIVE) // option_type (1 byte)
        .write_u128(100000); // execution gas data (16 bytes)

    // Add native drop option
    writer
        .write_u8(EXECUTOR_WORKER_ID) // worker_id (1 byte)
        .write_u16(49) // option_size: option_type(1) + amount(16) + receiver(32) = 49 bytes
        .write_u8(EXECUTOR_OPTION_TYPE_NATIVE_DROP) // option_type (1 byte)
        .write_u128(amount) // drop amount (16 bytes)
        .write_bytes_n(receiver); // receiver address (32 bytes)

    writer.to_bytes()
}

// ============================================================================
// Test Setup
// ============================================================================

/// DVN credentials for initialization (addresses for signers and admin).
pub struct DvnCredentials {
    /// secp256k1 addresses for DVN multisig
    pub signers: std::vec::Vec<Secp256k1KeyPair>,
    /// Ed25519 key pair for DVN admin address
    pub admin_keypair: Ed25519KeyPair,
}

impl DvnCredentials {
    /// Generate new DVN credentials with the specified number of signers.
    pub fn generate(num_signers: usize) -> Self {
        Self {
            signers: (0..num_signers).map(|_| Secp256k1KeyPair::generate()).collect(),
            admin_keypair: Ed25519KeyPair::generate(),
        }
    }

    /// Get the signer addresses as a Soroban Vec<BytesN<20>>.
    pub fn signer_addresses(&self, env: &Env) -> Vec<BytesN<20>> {
        let mut addrs: Vec<BytesN<20>> = vec![env];
        for kp in &self.signers {
            addrs.push_back(kp.signer(env));
        }
        addrs
    }

    /// Get the admin address for DVN registration.
    pub fn admin_address(&self, env: &Env) -> Address {
        self.admin_keypair.address(env)
    }
}

pub struct ChainSetup<'a> {
    pub eid: u32,
    pub owner: Address,
    pub admin: Address, // Worker admin
    pub native_token: Address,
    pub endpoint: EndpointV2Client<'a>,
    pub uln302: Uln302Client<'a>,
    pub dvn: DVNClient<'a>,
    pub dvn2: DVNClient<'a>, // Second DVN for multi-DVN tests
    pub executor: ExecutorClient<'a>,
    pub executor_helper: ExecutorHelperClient<'a>,
    pub price_feed: Address,
    pub counter: CounterClient<'a>,
}

impl<'a> ChainSetupCommon<'a> for ChainSetup<'a> {
    fn counter(&self) -> &CounterClient<'a> {
        &self.counter
    }
    fn endpoint(&self) -> &EndpointV2Client<'a> {
        &self.endpoint
    }
    fn native_token(&self) -> &Address {
        &self.native_token
    }
    fn owner(&self) -> &Address {
        &self.owner
    }
    fn validate_packet(
        &self,
        env: &Env,
        packet_event: &(soroban_sdk::Bytes, soroban_sdk::Bytes, Address),
    ) -> endpoint_v2::OutboundPacket {
        use message_lib_common::packet_codec_v1;

        let packet = decode_packet(env, &packet_event.0);
        let encoded_header = packet_codec_v1::encode_packet_header(env, &packet);
        let payload_hash = packet_codec_v1::payload_hash(env, &packet);

        // DVN verify with mock_auths
        let receive_uln302 = ReceiveUln302Client::new(env, &self.uln302.address);

        env.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &self.dvn.address,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &self.uln302.address,
                fn_name: "verify",
                args: (&self.dvn.address, &encoded_header, &payload_hash, &CONFIRMATIONS).into_val(env),
                sub_invokes: &[],
            },
        }]);
        receive_uln302.verify(&self.dvn.address, &encoded_header, &payload_hash, &CONFIRMATIONS);

        // Commit verification (permissionless)
        receive_uln302.commit_verification(&encoded_header, &payload_hash);

        packet
    }
}

pub struct TestSetup<'a> {
    pub env: Env,
    pub chain_a: ChainSetup<'a>,
    pub chain_b: ChainSetup<'a>,
}

/// Intermediate structure to hold chain infrastructure before DVN/Executor creation
struct ChainInfra {
    eid: u32,
    endpoint_address: Address,
    uln302_address: Address,
    #[allow(dead_code)]
    treasury_address: Address,
    price_feed_address: Address,
    dvn_fee_lib_address: Address,
    executor_fee_lib_address: Address,
    native_token: Address,
    zro_token: Address,
    admin: Address,
    deposit_address: Address,
    /// DVN credentials (addresses for initialization)
    dvn_credentials: DvnCredentials,
}

/// Phase 1: Create basic chain infrastructure (Endpoint, ULN302, Treasury, etc.)
fn setup_chain_infrastructure(env: &Env, owner: &Address) -> ChainInfra {
    // Create native token for endpoint fees
    let native_sac = env.register_stellar_asset_contract_v2(owner.clone());
    let native_token = native_sac.address();

    // Create ZRO token
    let zro_sac = env.register_stellar_asset_contract_v2(owner.clone());
    let zro_token = zro_sac.address();

    // Register endpoint
    let eid: u32 = 30400; // Test EID
    let endpoint_address = env.register(EndpointV2, (owner, eid, &native_token));

    // Register Treasury (real)
    let treasury_address = env.register(Treasury, (owner,));

    // Register PriceFeed (real)
    let price_updater = Address::generate(env);
    let price_feed_address = env.register(LzPriceFeed, (owner, &price_updater));

    // Register fee libs
    let dvn_fee_lib_address = env.register(DvnFeeLib, (owner,));
    let executor_fee_lib_address = env.register(ExecutorFeeLib, (owner,));

    // Register ULN302
    let uln302_address = env.register(Uln302, (owner, &endpoint_address, &treasury_address));

    // Create admin for workers
    let admin = Address::generate(env);

    // Deposit address for fee collection
    let deposit_address = Address::generate(env);

    // Generate real DVN credentials (1 signer with threshold 1)
    let dvn_credentials = DvnCredentials::generate(1);

    ChainInfra {
        eid,
        endpoint_address,
        uln302_address,
        treasury_address: treasury_address.clone(),
        price_feed_address,
        dvn_fee_lib_address,
        executor_fee_lib_address,
        native_token,
        zro_token,
        admin,
        deposit_address,
        dvn_credentials,
    }
}

/// Phase 2: Create DVN, Executor, and ExecutorHelper with cross-chain ULN302 support
fn setup_chain_workers<'a>(
    env: &Env,
    owner: &Address,
    infra: &ChainInfra,
    all_uln302_addresses: &Vec<Address>, // All ULN302 addresses across chains
) -> (DVNClient<'a>, DVNClient<'a>, ExecutorClient<'a>, ExecutorHelperClient<'a>) {
    // Use the DVN admin address from credentials, plus the worker admin
    let admins = vec![env, infra.admin.clone(), infra.dvn_credentials.admin_address(env)];

    // Use real secp256k1 signers from credentials
    let signers = infra.dvn_credentials.signer_addresses(env);
    let threshold: u32 = infra.dvn_credentials.signers.len() as u32;

    // Register first DVN with ALL ULN302 addresses as supported message libs
    let dvn_address = env.register(
        LzDVN,
        (
            DVN_VID,                    // vid
            &signers,                   // signers (real secp256k1 addresses)
            threshold,                  // threshold
            &admins,                    // admins
            all_uln302_addresses,       // supported_msglibs - ALL chains' ULN302s
            &infra.price_feed_address,  // price_feed
            DEFAULT_MULTIPLIER_BPS,     // default_multiplier_bps
            &infra.dvn_fee_lib_address, // worker_fee_lib
            &infra.deposit_address,     // deposit_address
        ),
    );

    // Register second DVN for multi-DVN verification tests
    let dvn2_credentials = DvnCredentials::generate(1);
    let admins2 = vec![env, infra.admin.clone(), dvn2_credentials.admin_address(env)];
    let signers2 = dvn2_credentials.signer_addresses(env);
    let dvn2_address = env.register(
        LzDVN,
        (
            DVN_VID + 1, // Different vid for second DVN
            &signers2,
            1u32, // threshold
            &admins2,
            all_uln302_addresses,
            &infra.price_feed_address,
            DEFAULT_MULTIPLIER_BPS,
            &infra.dvn_fee_lib_address,
            &infra.deposit_address,
        ),
    );

    // Register ExecutorHelper (stateless entry point for executor AA workflow)
    let executor_helper_address = env.register(ExecutorHelper, ());

    // Register real Executor with ALL ULN302 addresses as supported message libs
    let executor_address = env.register(
        LzExecutor,
        (
            &infra.endpoint_address,
            owner,
            &admins,
            all_uln302_addresses, // supported_msglibs - ALL chains' ULN302s
            &infra.price_feed_address,
            DEFAULT_MULTIPLIER_BPS,
            &infra.executor_fee_lib_address, // worker_fee_lib
            &infra.deposit_address,          // deposit_address
        ),
    );

    let dvn = DVNClient::new(env, &dvn_address);
    let dvn2 = DVNClient::new(env, &dvn2_address);
    let executor = ExecutorClient::new(env, &executor_address);
    let executor_helper = ExecutorHelperClient::new(env, &executor_helper_address);

    // Register the executor helper with the executor (address + allowed function names)
    let allowed_functions: Vec<Symbol> =
        vec![env, Symbol::new(env, "execute"), Symbol::new(env, "compose")];
    let lz_executor = LzExecutorClient::new(env, &executor_address);
    env.mock_auths(&[MockAuth {
        address: owner,
        invoke: &MockAuthInvoke {
            contract: &executor_address,
            fn_name: "set_executor_helper",
            args: (&executor_helper_address, &allowed_functions).into_val(env),
            sub_invokes: &[],
        },
    }]);
    lz_executor.set_executor_helper(&executor_helper_address, &allowed_functions);

    (dvn, dvn2, executor, executor_helper)
}

/// Phase 3: Complete chain setup by creating Counter and finalizing configuration
fn finalize_chain_setup<'a>(
    env: &Env,
    owner: &Address,
    infra: ChainInfra,
    dvn: DVNClient<'a>,
    dvn2: DVNClient<'a>,
    executor: ExecutorClient<'a>,
    executor_helper: ExecutorHelperClient<'a>,
) -> ChainSetup<'a> {
    // Register Counter OApp
    let counter_address = env.register(Counter, (owner, &infra.endpoint_address, owner));

    // Create clients
    let endpoint = EndpointV2Client::new(env, &infra.endpoint_address);
    let uln302 = Uln302Client::new(env, &infra.uln302_address);
    let counter = CounterClient::new(env, &counter_address);

    set_zro(env, owner, &endpoint, &infra.zro_token);
    register_library(env, owner, &endpoint, &uln302.address);

    let eid = infra.eid;
    let native_token = infra.native_token.clone();

    // Set up price feed with initial prices for this chain's eid
    setup_price_feed(env, owner, &infra.price_feed_address, eid);

    let chain_setup = ChainSetup {
        owner: owner.clone(),
        admin: infra.admin,
        endpoint,
        uln302,
        dvn,
        dvn2,
        executor,
        executor_helper,
        price_feed: infra.price_feed_address,
        counter,
        eid,
        native_token,
    };

    // Allow executor self-spend so transfer_from succeeds in compose tests.
    env.mock_all_auths();
    TokenClient::new(env, &chain_setup.native_token).approve(
        &chain_setup.executor.address,
        &chain_setup.executor.address,
        &i128::MAX,
        &10_u32,
    );

    chain_setup
}

/// Set up price feed with test prices
fn setup_price_feed(env: &Env, owner: &Address, price_feed: &Address, eid: u32) {
    let client = price_feed::LzPriceFeedClient::new(env, price_feed);

    // Set price ratio denominator
    env.mock_auths(&[MockAuth {
        address: owner,
        invoke: &MockAuthInvoke {
            contract: price_feed,
            fn_name: "set_price_ratio_denominator",
            args: (&PRICE_RATIO_DENOMINATOR,).into_val(env),
            sub_invokes: &[],
        },
    }]);
    client.set_price_ratio_denominator(&PRICE_RATIO_DENOMINATOR);

    // Set native token price in USD (1 XLM = 1 USD for simplicity, scaled)
    let native_price_usd: u128 = 10_000_000; // 1 USD with 7 decimals
    env.mock_auths(&[MockAuth {
        address: owner,
        invoke: &MockAuthInvoke {
            contract: price_feed,
            fn_name: "set_native_token_price_usd",
            args: (owner, &native_price_usd).into_val(env),
            sub_invokes: &[],
        },
    }]);
    client.set_native_token_price_usd(owner, &native_price_usd);

    // Set price for this eid (for testing, use 1:1 price ratio)
    // Price feed internally uses eid % 30000 for lookups, so we need to normalize
    let normalized_eid = eid % 30_000;
    let price = Price {
        price_ratio: PRICE_RATIO_DENOMINATOR,
        gas_price_in_unit: DEFAULT_GAS_PRICE,
        gas_per_byte: DEFAULT_GAS_PER_BYTE,
    };

    // Note: STELLAR_EID (30111) normalizes to 111, which is the Optimism mainnet EID.
    // The Optimism fee model requires prices for BOTH L2 (111) AND L1 Ethereum (101).
    // So we set prices for both.
    let mut prices = vec![env, UpdatePrice { eid: normalized_eid, price: price.clone() }];

    // If this is an Optimism-style chain (111, 10132, 20132), also set L1 Ethereum price
    if normalized_eid == 111 {
        prices.push_back(UpdatePrice { eid: 101, price: price.clone() }); // Ethereum mainnet
    } else if normalized_eid == 10132 {
        prices.push_back(UpdatePrice { eid: 10121, price: price.clone() }); // Ethereum Goerli
    } else if normalized_eid == 20132 {
        prices.push_back(UpdatePrice { eid: 20121, price: price.clone() }); // Ethereum Goerli
    }

    env.mock_auths(&[MockAuth {
        address: owner,
        invoke: &MockAuthInvoke {
            contract: price_feed,
            fn_name: "set_price",
            args: (owner, &prices).into_val(env),
            sub_invokes: &[],
        },
    }]);
    client.set_price(owner, &prices);
}

pub fn setup<'a>() -> TestSetup<'a> {
    let env = Env::default();
    env.mock_all_auths(); // Required for contract registration (DVN multisig init, etc.)
    let owner = Address::generate(&env);

    // Phase 1: Create basic infrastructure for both chains
    let infra_a = setup_chain_infrastructure(&env, &owner);
    let infra_b = setup_chain_infrastructure(&env, &owner);

    // Collect all ULN302 addresses for cross-chain support
    let all_uln302_addresses: Vec<Address> = vec![&env, infra_a.uln302_address.clone(), infra_b.uln302_address.clone()];

    // Phase 2: Create workers with cross-chain ULN302 support
    let (dvn_a, dvn2_a, executor_a, executor_helper_a) =
        setup_chain_workers(&env, &owner, &infra_a, &all_uln302_addresses);
    let (dvn_b, dvn2_b, executor_b, executor_helper_b) =
        setup_chain_workers(&env, &owner, &infra_b, &all_uln302_addresses);

    // Phase 3: Finalize chain setup
    let chain_a = finalize_chain_setup(&env, &owner, infra_a, dvn_a, dvn2_a, executor_a, executor_helper_a);
    let chain_b = finalize_chain_setup(&env, &owner, infra_b, dvn_b, dvn2_b, executor_b, executor_helper_b);

    TestSetup { env, chain_a, chain_b }
}

/// DVN configuration mode for endpoint wiring.
#[derive(Clone, Copy)]
pub enum DvnMode {
    /// Single DVN: required = [dvn], no optional
    Single,
    /// Two required DVNs: required = [dvn, dvn2], no optional
    TwoRequired,
    /// Duplicate DVN in optional: required = [dvn], optional = [dvn, dvn2], threshold = 1
    DuplicateOptional,
}

/// Creates a fully wired test setup with the specified DVN mode.
pub fn wired_setup_with_dvn_mode<'a>(mode: DvnMode) -> TestSetup<'a> {
    let test_setup = setup();
    wire_endpoint(&test_setup.env, &[&test_setup.chain_a, &test_setup.chain_b], mode);
    wire_counter(&test_setup.env, &[&test_setup.chain_a, &test_setup.chain_b]);
    test_setup
}

// ============================================================================
// Wire functions
// ============================================================================

pub fn wire_endpoint(env: &Env, chains: &[&ChainSetup<'_>], mode: DvnMode) {
    // First pass: Set up price feeds with cross-chain prices
    for chain in chains {
        for other_chain in chains {
            if chain.endpoint.address == other_chain.endpoint.address {
                continue;
            }
            setup_price_feed(env, &chain.owner, &chain.price_feed, other_chain.eid);
        }
    }

    // Second pass: Set up DVN and Executor dst configs
    for chain in chains {
        for other_chain in chains {
            if chain.endpoint.address == other_chain.endpoint.address {
                continue;
            }
            set_dvn_dst_config(env, &chain.admin, &chain.dvn, other_chain.eid);
            // For multi-DVN modes, also configure dvn2
            if matches!(mode, DvnMode::TwoRequired | DvnMode::DuplicateOptional) {
                set_dvn_dst_config(env, &chain.admin, &chain.dvn2, other_chain.eid);
            }
            set_executor_dst_config(env, &chain.admin, &chain.executor, other_chain.eid);
        }
    }

    // Third pass: Set up ULN configs based on DVN mode
    for chain in chains {
        for other_chain in chains {
            if chain.endpoint.address == other_chain.endpoint.address {
                continue;
            }

            let (send_required, recv_required, send_optional, recv_optional, optional_threshold) = match mode {
                DvnMode::Single => (
                    vec![env, other_chain.dvn.address.clone()],
                    vec![env, chain.dvn.address.clone()],
                    vec![env],
                    vec![env],
                    0,
                ),
                DvnMode::TwoRequired => (
                    vec![env, other_chain.dvn.address.clone(), other_chain.dvn2.address.clone()],
                    vec![env, chain.dvn.address.clone(), chain.dvn2.address.clone()],
                    vec![env],
                    vec![env],
                    0,
                ),
                DvnMode::DuplicateOptional => (
                    vec![env, other_chain.dvn.address.clone()],
                    vec![env, chain.dvn.address.clone()],
                    vec![env, other_chain.dvn.address.clone(), other_chain.dvn2.address.clone()],
                    vec![env, chain.dvn.address.clone(), chain.dvn2.address.clone()],
                    1,
                ),
            };

            set_default_send_uln_config_with_optional(
                env,
                &chain.owner,
                &chain.uln302,
                other_chain.eid,
                &send_required,
                &send_optional,
                optional_threshold,
            );

            set_default_receive_uln_config_with_optional(
                env,
                &chain.owner,
                &chain.uln302,
                other_chain.eid,
                &recv_required,
                &recv_optional,
                optional_threshold,
            );

            set_default_executor_config(env, &chain.owner, &chain.uln302, other_chain.eid, &chain.executor.address);
        }
    }

    // Fourth pass: Set default send and receive libraries
    for chain in chains {
        for other_chain in chains {
            if chain.endpoint.address == other_chain.endpoint.address {
                continue;
            }

            set_default_send_library(env, &chain.owner, &chain.endpoint, other_chain.eid, &chain.uln302.address);
            set_default_receive_library(env, &chain.owner, &chain.endpoint, other_chain.eid, &chain.uln302.address);
        }
    }
}

/// Set DVN destination config
fn set_dvn_dst_config(env: &Env, admin: &Address, dvn: &DVNClient<'_>, dst_eid: u32) {
    let config = DvnDstConfig {
        gas: 100_000,          // Gas for verification
        multiplier_bps: 10000, // 100%
        floor_margin_usd: 0,   // No floor margin for tests
    };
    let params = vec![env, DvnDstConfigParam { dst_eid, config }];

    env.mock_auths(&[MockAuth {
        address: admin,
        invoke: &MockAuthInvoke {
            contract: &dvn.address,
            fn_name: "set_dst_config",
            args: (admin, &params).into_val(env),
            sub_invokes: &[],
        },
    }]);
    dvn.set_dst_config(admin, &params);
}

/// Set Executor destination config
fn set_executor_dst_config(env: &Env, admin: &Address, executor: &ExecutorClient<'_>, dst_eid: u32) {
    let config = ExecutorDstConfig {
        lz_receive_base_gas: 50_000, // Base gas for lz_receive
        multiplier_bps: 10000,       // 100%
        floor_margin_usd: 0,         // No floor margin for tests
        native_cap: 1_000_000_000,   // Max native drop
        lz_compose_base_gas: 30_000, // Base gas for lz_compose
    };
    let params = vec![env, SetDstConfigParam { dst_eid, dst_config: config }];

    env.mock_auths(&[MockAuth {
        address: admin,
        invoke: &MockAuthInvoke {
            contract: &executor.address,
            fn_name: "set_dst_config",
            args: (admin, &params).into_val(env),
            sub_invokes: &[],
        },
    }]);
    executor.set_dst_config(admin, &params);
}

pub fn wire_counter(env: &Env, chains: &[&ChainSetup<'_>]) {
    for chain in chains {
        for other_chain in chains {
            if chain.endpoint.address == other_chain.endpoint.address {
                continue;
            }
            set_peer(
                env,
                &chain.owner,
                &chain.counter,
                other_chain.eid,
                &address_to_bytes32(&other_chain.counter.address),
            );
        }
    }
}

pub fn set_default_send_library(
    env: &Env,
    owner: &Address,
    endpoint: &EndpointV2Client<'_>,
    dst_eid: u32,
    lib: &Address,
) {
    env.mock_auths(&[MockAuth {
        address: owner,
        invoke: &MockAuthInvoke {
            contract: &endpoint.address,
            fn_name: "set_default_send_library",
            args: (&dst_eid, lib).into_val(env),
            sub_invokes: &[],
        },
    }]);
    endpoint.set_default_send_library(&dst_eid, lib);
}

pub fn set_default_receive_library(
    env: &Env,
    owner: &Address,
    endpoint: &EndpointV2Client<'_>,
    src_eid: u32,
    lib: &Address,
) {
    env.mock_auths(&[MockAuth {
        address: owner,
        invoke: &MockAuthInvoke {
            contract: &endpoint.address,
            fn_name: "set_default_receive_library",
            args: (&src_eid, lib, &0u64).into_val(env),
            sub_invokes: &[],
        },
    }]);
    endpoint.set_default_receive_library(&src_eid, lib, &0u64);
}

pub fn set_default_send_uln_config_with_optional(
    env: &Env,
    owner: &Address,
    uln302: &Uln302Client<'_>,
    dst_eid: u32,
    required_dvns: &soroban_sdk::Vec<Address>,
    optional_dvns: &soroban_sdk::Vec<Address>,
    optional_dvn_threshold: u32,
) {
    let config = UlnConfig {
        confirmations: CONFIRMATIONS,
        required_dvns: required_dvns.clone(),
        optional_dvns: optional_dvns.clone(),
        optional_dvn_threshold,
    };
    let params = vec![env, SetDefaultUlnConfigParam { eid: dst_eid, config }];

    env.mock_auths(&[MockAuth {
        address: owner,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "set_default_send_uln_configs",
            args: (&params,).into_val(env),
            sub_invokes: &[],
        },
    }]);
    SendUln302Client::new(env, &uln302.address).set_default_send_uln_configs(&params);
}

pub fn set_default_receive_uln_config_with_optional(
    env: &Env,
    owner: &Address,
    uln302: &Uln302Client<'_>,
    src_eid: u32,
    required_dvns: &soroban_sdk::Vec<Address>,
    optional_dvns: &soroban_sdk::Vec<Address>,
    optional_dvn_threshold: u32,
) {
    let config = UlnConfig {
        confirmations: CONFIRMATIONS,
        required_dvns: required_dvns.clone(),
        optional_dvns: optional_dvns.clone(),
        optional_dvn_threshold,
    };
    let params = vec![env, SetDefaultUlnConfigParam { eid: src_eid, config }];

    env.mock_auths(&[MockAuth {
        address: owner,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "set_default_receive_uln_configs",
            args: (&params,).into_val(env),
            sub_invokes: &[],
        },
    }]);
    ReceiveUln302Client::new(env, &uln302.address).set_default_receive_uln_configs(&params);
}

pub fn set_default_executor_config(
    env: &Env,
    owner: &Address,
    uln302: &Uln302Client<'_>,
    dst_eid: u32,
    executor: &Address,
) {
    let config = ExecutorConfig { max_message_size: MAX_MESSAGE_SIZE, executor: executor.clone() };
    let params = vec![env, SetDefaultExecutorConfigParam { dst_eid, config }];

    env.mock_auths(&[MockAuth {
        address: owner,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "set_default_executor_configs",
            args: (&params,).into_val(env),
            sub_invokes: &[],
        },
    }]);
    SendUln302Client::new(env, &uln302.address).set_default_executor_configs(&params);
}

// ============================================================================
// Executor Helper Functions
// ============================================================================

use crate::tests::mint_to;
use endpoint_v2::{Origin, OutboundPacket};
use executor_helper::{ComposeParams, ExecutionParams};
use soroban_sdk::Bytes;

/// Execute lz_receive via ExecutorHelper (executor AA workflow).
/// Automatically mints native tokens to the admin if value > 0.
pub fn lz_receive_via_executor(
    env: &Env,
    chain: &ChainSetup<'_>,
    admin: &Address,
    packet: &OutboundPacket,
    value: i128,
) {
    // Mint native tokens to admin if value > 0
    if value > 0 {
        mint_to(env, &chain.owner, &chain.native_token, admin, value);
    }

    let origin = Origin { src_eid: packet.src_eid, sender: address_to_bytes32(&packet.sender), nonce: packet.nonce };

    let params = ExecutionParams {
        receiver: chain.counter.address.clone(),
        origin: origin.clone(),
        guid: packet.guid.clone(),
        message: packet.message.clone(),
        extra_data: Bytes::new(env),
        value,
        gas_limit: 1_000_000, // Arbitrary gas limit for tests
    };

    env.mock_all_auths_allowing_non_root_auth();
    chain.executor_helper.execute(&chain.executor.address, &params, admin);
}

/// Execute lz_compose via ExecutorHelper (executor AA workflow).
/// Automatically mints native tokens to the admin if value > 0.
pub fn lz_compose_via_executor(
    env: &Env,
    chain: &ChainSetup<'_>,
    admin: &Address,
    packet: &OutboundPacket,
    value: i128,
) {
    // Mint native tokens to admin if value > 0
    if value > 0 {
        mint_to(env, &chain.owner, &chain.native_token, admin, value);
    }

    let params = ComposeParams {
        from: chain.counter.address.clone(),
        to: chain.counter.address.clone(),
        guid: packet.guid.clone(),
        index: 0,
        message: packet.message.clone(),
        extra_data: Bytes::new(env),
        value,
        gas_limit: 1_000_000, // Arbitrary gas limit for tests
    };

    env.mock_all_auths_allowing_non_root_auth();
    chain.executor_helper.compose(&chain.executor.address, &params, admin);
}
