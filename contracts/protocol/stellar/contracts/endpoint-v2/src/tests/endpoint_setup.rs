use soroban_sdk::token::TokenClient;
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token::StellarAssetClient,
    vec, Address, Bytes, BytesN, Env, IntoVal, Val, Vec,
};

use crate::{
    endpoint_v2::{EndpointV2, EndpointV2Client},
    storage,
    tests::mock::{
        MockMessageLib, MockMessageLibClient, MockReceiveLib, MockReceiveLibClient, MockSendLib, MockSendLibClient,
    },
    MessageLibType,
};

pub struct TestSetup<'a> {
    pub eid: u32,
    pub endpoint_client: EndpointV2Client<'a>,
    pub env: Env,
    pub owner: Address,
    pub contract_id: Address,
    pub native_token_client: StellarAssetClient<'a>,
    pub zro_token_client: StellarAssetClient<'a>,
}

pub fn setup<'a>() -> TestSetup<'a> {
    let env = Env::default();

    let owner = Address::generate(&env);

    // Deploy native token contract
    let native_token = env.register_stellar_asset_contract_v2(owner.clone());
    let native_token_address = native_token.address();
    let native_token_client = StellarAssetClient::new(&env, &native_token_address);

    // Deploy ZRO token
    let zro_token = env.register_stellar_asset_contract_v2(owner.clone());
    let zro_token_address = zro_token.address();
    let zro_token_client = StellarAssetClient::new(&env, &zro_token_address);

    // Deploy the endpoint contract
    let eid: u32 = 30400; // Test EID
    let contract_id = env.register(EndpointV2, (&owner, eid, &native_token_address));
    let endpoint_client = EndpointV2Client::new(&env, &contract_id);

    TestSetup { eid, endpoint_client, env, owner, contract_id, native_token_client, zro_token_client }
}

impl<'a> TestSetup<'a> {
    /// Helper function to mint native tokens with proper authorization
    pub fn mint_native(&self, to: &Address, amount: i128) {
        self.env.mock_auths(&[MockAuth {
            address: &self.owner,
            invoke: &MockAuthInvoke {
                contract: &self.native_token_client.address,
                fn_name: "mint",
                args: (to, amount).into_val(&self.env),
                sub_invokes: &[],
            },
        }]);
        self.native_token_client.mint(to, &amount);
    }

    /// Helper function to mint ZRO tokens with proper authorization
    pub fn mint_zro(&self, to: &Address, amount: i128) {
        self.env.mock_auths(&[MockAuth {
            address: &self.owner,
            invoke: &MockAuthInvoke {
                contract: &self.zro_token_client.address,
                fn_name: "mint",
                args: (to, amount).into_val(&self.env),
                sub_invokes: &[],
            },
        }]);
        self.zro_token_client.mint(to, &amount);
    }

    /// Helper function to transfer native tokens with proper authorization
    pub fn transfer_native(&self, from: &Address, to: &Address, amount: i128) {
        let env = &self.env;
        let token_client = TokenClient::new(env, &self.native_token_client.address);
        env.mock_auths(&[MockAuth {
            address: from,
            invoke: &MockAuthInvoke {
                contract: &self.native_token_client.address,
                fn_name: "transfer",
                args: (from, to, &amount).into_val(env),
                sub_invokes: &[],
            },
        }]);
        token_client.transfer(from, to, &amount);
    }

    /// Helper function to transfer ZRO tokens with proper authorization
    pub fn transfer_zro(&self, from: &Address, to: &Address, amount: i128) {
        let env = &self.env;
        let token_client = TokenClient::new(env, &self.zro_token_client.address);
        env.mock_auths(&[MockAuth {
            address: from,
            invoke: &MockAuthInvoke {
                contract: &self.zro_token_client.address,
                fn_name: "transfer",
                args: (from, to, &amount).into_val(env),
                sub_invokes: &[],
            },
        }]);
        token_client.transfer(from, to, &amount);
    }

    /// Helper to mint native tokens to `from` and transfer them to the endpoint contract.
    pub fn fund_endpoint_with_native(&self, from: &Address, amount: i128) {
        self.mint_native(from, amount);
        self.transfer_native(from, &self.endpoint_client.address, amount);
    }

    /// Helper to mint ZRO tokens to `from` and transfer them to the endpoint contract.
    pub fn fund_endpoint_with_zro(&self, from: &Address, amount: i128) {
        self.mint_zro(from, amount);
        self.transfer_zro(from, &self.endpoint_client.address, amount);
    }

    // Helper to mock owner auth for common operations
    pub fn mock_owner_auth<T: IntoVal<Env, Vec<Val>>>(&self, fn_name: &str, args: T) {
        self.env.mock_auths(&[MockAuth {
            address: &self.owner,
            invoke: &MockAuthInvoke {
                contract: &self.contract_id,
                fn_name,
                args: args.into_val(&self.env),
                sub_invokes: &[],
            },
        }]);
    }

    // Helper to mock auth for any address
    pub fn mock_auth<T: IntoVal<Env, Vec<Val>>>(&self, address: &Address, fn_name: &str, args: T) {
        self.env.mock_auths(&[MockAuth {
            address,
            invoke: &MockAuthInvoke {
                contract: &self.contract_id,
                fn_name,
                args: args.into_val(&self.env),
                sub_invokes: &[],
            },
        }]);
    }

    // Helper function to create and setup a mock message library
    pub fn setup_mock_message_lib(&self, lib_type: MessageLibType, supported_eids: Vec<u32>) -> Address {
        let lib = self.env.register(MockMessageLib, ());
        let lib_client = MockMessageLibClient::new(&self.env, &lib);
        lib_client.setup(&lib_type, &supported_eids);
        lib
    }

    // Helper function to create and setup a mock send library
    pub fn setup_mock_send_lib(
        &self,
        supported_eids: Vec<u32>,
        native_fee: i128,
        zro_fee: i128,
        fee_recipient: Address,
    ) -> Address {
        let lib = self.env.register(MockSendLib, ());
        let lib_client = MockSendLibClient::new(&self.env, &lib);
        lib_client.setup(&supported_eids, &native_fee, &zro_fee, &fee_recipient);
        lib
    }

    // Helper function to create and setup a mock receive library
    pub fn setup_mock_receive_lib(&self, supported_eids: Vec<u32>) -> Address {
        let lib = self.env.register(MockReceiveLib, ());
        let lib_client = MockReceiveLibClient::new(&self.env, &lib);
        lib_client.setup(&supported_eids);
        lib
    }

    /// Helper to setup (or rotate) a default receive library for a source endpoint with a grace period.
    /// Creates a mock receive library, registers it, and sets it as the default for the given src_eid.
    pub fn setup_default_receive_lib(&self, src_eid: u32, grace_period: u64) -> Address {
        let receive_lib = self.setup_mock_receive_lib(vec![&self.env, src_eid]);

        self.register_library_with_auth(&receive_lib);
        self.set_default_receive_library_with_auth(src_eid, &receive_lib, grace_period);

        receive_lib
    }

    pub fn set_default_receive_library_with_auth(&self, src_eid: u32, receive_lib: &Address, grace_period: u64) {
        self.mock_owner_auth("set_default_receive_library", (&src_eid, receive_lib, &grace_period));
        self.endpoint_client.set_default_receive_library(&src_eid, receive_lib, &grace_period);
    }

    pub fn set_default_send_library_with_auth(&self, dst_eid: u32, send_lib: &Address) {
        self.mock_owner_auth("set_default_send_library", (&dst_eid, send_lib));
        self.endpoint_client.set_default_send_library(&dst_eid, send_lib);
    }

    /// Helper to setup a default send library for a destination endpoint.
    /// Creates a mock send library, registers it, and sets it as the default for the given dst_eid.
    pub fn setup_default_send_lib(&self, dst_eid: u32, native_fee: i128, zro_fee: i128) -> (Address, Address) {
        let fee_recipient = Address::generate(&self.env);
        let send_lib = self.setup_mock_send_lib(vec![&self.env, dst_eid], native_fee, zro_fee, fee_recipient.clone());

        self.register_library_with_auth(&send_lib);

        self.set_default_send_library_with_auth(dst_eid, &send_lib);

        (send_lib, fee_recipient)
    }

    /// Helper to setup ZRO token on the endpoint
    pub fn setup_zro_with_auth(&self) {
        self.mock_owner_auth("set_zro", (&self.zro_token_client.address,));
        self.endpoint_client.set_zro(&self.zro_token_client.address);
    }

    /// Helper to register a message library as the contract owner (mocks owner auth + performs call).
    pub fn register_library_with_auth(&self, lib: &Address) {
        self.mock_owner_auth("register_library", (lib,));
        self.endpoint_client.register_library(lib);
    }

    /// Helper to setup a new custom receive library for an OApp with a grace period.
    /// Returns the newly created receive library address.
    pub fn setup_receive_library(
        &self,
        caller: &Address,
        receiver: &Address,
        src_eid: u32,
        grace_period: u64,
    ) -> Address {
        let lib = self.setup_mock_receive_lib(vec![&self.env, src_eid]);
        self.register_library_with_auth(&lib);
        self.set_receive_library_with_auth(caller, receiver, src_eid, &Some(lib.clone()), grace_period);
        lib
    }

    pub fn set_receive_library_with_auth(
        &self,
        caller: &Address,
        receiver: &Address,
        src_eid: u32,
        new_lib: &Option<Address>,
        grace_period: u64,
    ) {
        self.mock_auth(caller, "set_receive_library", (caller, receiver, src_eid, new_lib, grace_period));
        self.endpoint_client.set_receive_library(caller, receiver, &src_eid, new_lib, &grace_period);
    }

    pub fn set_send_library_with_auth(
        &self,
        caller: &Address,
        sender: &Address,
        dst_eid: u32,
        new_lib: &Option<Address>,
    ) {
        self.mock_auth(caller, "set_send_library", (caller, sender, dst_eid, new_lib));
        self.endpoint_client.set_send_library(caller, sender, &dst_eid, new_lib);
    }

    pub fn set_delegate_with_auth(&self, oapp: &Address, delegate: &Option<Address>) {
        self.mock_auth(oapp, "set_delegate", (oapp, delegate));
        self.endpoint_client.set_delegate(oapp, delegate);
    }

    pub fn send_compose_with_auth(&self, from: &Address, to: &Address, guid: &BytesN<32>, index: u32, message: &Bytes) {
        self.mock_auth(from, "send_compose", (from, to, guid, &index, message));
        self.endpoint_client.send_compose(from, to, guid, &index, message);
    }

    pub fn set_inbound_nonce(&self, receiver: &Address, src_eid: u32, sender: &BytesN<32>, inbound_nonce: u64) {
        let env = &self.env;
        let endpoint_client = &self.endpoint_client;
        env.as_contract(&endpoint_client.address, || {
            storage::EndpointStorage::set_inbound_nonce(env, receiver, src_eid, sender, &inbound_nonce)
        });
    }

    /// Helper to mark an inbound message as verified by writing its payload hash into storage.
    ///
    /// This is a test-only utility used by multiple messaging channel test suites.
    pub fn inbound_as_verified(
        &self,
        receiver: &Address,
        src_eid: u32,
        sender: &BytesN<32>,
        nonce: u64,
        payload_hash: &BytesN<32>,
    ) {
        let env = &self.env;
        let endpoint_client = &self.endpoint_client;
        env.as_contract(&endpoint_client.address, || {
            EndpointV2::inbound_for_test(env, receiver, src_eid, sender, nonce, payload_hash)
        });
    }
}
