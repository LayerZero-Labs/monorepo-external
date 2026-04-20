use crate::{errors::OAppError, oapp_receiver::RECEIVER_VERSION, oapp_sender::SENDER_VERSION};
use common_macros::{contract_trait, only_role, storage};
use endpoint_v2::LayerZeroEndpointV2Client;
use soroban_sdk::{contractevent, Address, BytesN, Env};
use utils::{
    option_ext::OptionExt,
    ownable::{Ownable, OwnableInitializer},
    rbac::{RoleBasedAccessControl, AUTHORIZER},
};

// =====================================================
// OAppCore Storage and Events
// =====================================================

#[storage]
pub enum OAppCoreStorage {
    // Endpoint address - set once during initialization
    #[instance(Address)]
    Endpoint,

    // Mapping from endpoint ID to remote peer address
    #[persistent(BytesN<32>)]
    Peer { eid: u32 },
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PeerSet {
    pub eid: u32,
    pub peer: Option<BytesN<32>>,
}

// =====================================================
// OAppCore Interface and Default Implementation
// =====================================================

#[contract_trait]
pub trait OAppCore: Ownable + RoleBasedAccessControl {
    /// Retrieves the OApp version information.
    ///
    /// # Returns
    /// A tuple containing:
    /// - `sender_version`: The version of the OAppSender
    /// - `receiver_version`: The version of the OAppReceiver
    fn oapp_version(_env: &soroban_sdk::Env) -> (u64, u64) {
        (SENDER_VERSION, RECEIVER_VERSION)
    }

    /// Retrieves the LayerZero endpoint address associated with the OApp.
    ///
    /// # Returns
    /// The LayerZero endpoint address
    fn endpoint(env: &soroban_sdk::Env) -> soroban_sdk::Address {
        OAppCoreStorage::endpoint(env).unwrap()
    }

    /// Retrieves the peer (OApp) associated with a corresponding endpoint.
    ///
    /// # Arguments
    /// * `eid` - The endpoint ID
    ///
    /// # Returns
    /// The peer address (OApp instance) associated with the corresponding endpoint
    fn peer(env: &soroban_sdk::Env, eid: u32) -> Option<soroban_sdk::BytesN<32>> {
        OAppCoreStorage::peer(env, eid)
    }

    /// Sets or removes the peer address (OApp instance) for a corresponding endpoint.
    ///
    /// # Arguments
    /// * `eid` - The endpoint ID
    /// * `peer` - The address of the peer to be associated with the corresponding endpoint, or None to remove the peer
    /// * `operator` - The authorizer address
    #[only_role(operator, AUTHORIZER)]
    fn set_peer(
        env: &soroban_sdk::Env,
        eid: u32,
        peer: &Option<soroban_sdk::BytesN<32>>,
        operator: &soroban_sdk::Address,
    ) {
        OAppCoreStorage::set_or_remove_peer(env, eid, peer);
        PeerSet { eid, peer: peer.clone() }.publish(env);
    }

    /// Sets the delegate address for the OApp Core.
    ///
    /// # Arguments
    /// * `delegate` - The address of the delegate to be set, or None to remove the delegate
    /// * `operator` - The authorizer address
    #[only_role(operator, AUTHORIZER)]
    fn set_delegate(env: &soroban_sdk::Env, delegate: &Option<soroban_sdk::Address>, operator: &soroban_sdk::Address) {
        endpoint_client::<Self>(env).set_delegate(&env.current_contract_address(), delegate);
    }
}

// =====================================================
// Helper Functions
// =====================================================

/// Initializes the OApp with the specified configuration.
///
/// This function sets up the OApp by initializing ownership, storing the LayerZero endpoint,
/// and setting a delegate address for the endpoint.
///
/// # Arguments
/// * `env` - The Soroban environment
/// * `owner` - The address that will own this OApp
/// * `endpoint` - The LayerZero endpoint address to associate with this OApp
/// * `delegate` - The delegate address to set on the endpoint for this OApp
pub fn init_ownable_oapp<T: OAppCore + OwnableInitializer>(
    env: &Env,
    owner: &Address,
    endpoint: &Address,
    delegate: &Address,
) {
    T::init_owner(env, owner);
    OAppCoreStorage::set_endpoint(env, endpoint);
    LayerZeroEndpointV2Client::new(env, endpoint)
        .set_delegate(&env.current_contract_address(), &Some(delegate.clone()));
}

/// Retrieves the peer address associated with a specific endpoint ID; panics if NOT set.
///
/// This is a safe getter that ensures a peer has been configured for the given endpoint.
/// If no peer is set (i.e., the peer is `None`), it will panic with `OAppError::NoPeer`.
///
/// # Arguments
/// * `env` - The Soroban environment
/// * `eid` - The endpoint ID
///
/// # Returns
/// The peer address (`BytesN<32>`) associated with the specified endpoint
///
/// # Panics
/// Panics with `OAppError::NoPeer` if no peer is set for the given endpoint ID
pub fn get_peer_or_panic<T: OAppCore>(env: &Env, eid: u32) -> BytesN<32> {
    T::peer(env, eid).unwrap_or_panic(env, OAppError::NoPeer)
}

/// Returns a client for the LayerZero endpoint.
pub fn endpoint_client<'a, T: OAppCore>(env: &'a Env) -> LayerZeroEndpointV2Client<'a> {
    LayerZeroEndpointV2Client::new(env, &T::endpoint(env))
}
