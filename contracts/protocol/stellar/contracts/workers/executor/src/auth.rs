use super::*;
use endpoint_v2::LayerZeroEndpointV2Client;
use soroban_sdk::{
    address_payload::AddressPayload,
    auth::{Context, CustomAccountInterface},
    contracttype,
    crypto::Hash,
    Symbol, TryFromVal, Val,
};

// ============================================================================
// Authentication Data Types
// ============================================================================

/// Signature data for Custom Account authorization.
/// Contains the admin's public key and their Ed25519 signature over the authorization payload.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutorSignature {
    /// Admin's Ed25519 public key (32 bytes) - must correspond to a registered admin
    pub public_key: BytesN<32>,
    /// Ed25519 signature (64 bytes) over the signature_payload
    pub signature: BytesN<64>,
}

// ============================================================================
// Custom Account Interface Implementation
// ============================================================================

#[contract_impl]
impl CustomAccountInterface for LzExecutor {
    type Signature = ExecutorSignature;
    type Error = ExecutorError;

    /// Verifies authorization for the executor contract.
    ///
    /// The public key must correspond to a registered admin and must have signed the signature_payload.
    /// Uses Ed25519 signature verification.
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        auth_data: Self::Signature,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Self::Error> {
        Self::verify_admin_signature(&env, &signature_payload, &auth_data)?;
        Self::validate_auth_contexts(&env, &auth_contexts)?;
        Ok(())
    }
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

impl LzExecutor {
    /// Verifies that the signature is from a registered admin.
    ///
    /// Converts the public key to an address, checks admin registration,
    /// and verifies the Ed25519 signature over the payload.
    fn verify_admin_signature(
        env: &Env,
        signature_payload: &Hash<32>,
        auth_data: &ExecutorSignature,
    ) -> Result<(), ExecutorError> {
        let admin = Address::from_payload(env, AddressPayload::AccountIdPublicKeyEd25519(auth_data.public_key.clone()));
        if !Self::is_admin(env, &admin) {
            return Err(ExecutorError::Unauthorized);
        }
        env.crypto().ed25519_verify(&auth_data.public_key, &signature_payload.clone().into(), &auth_data.signature);
        Ok(())
    }

    /// Validates auth contexts according to executor rules.
    ///
    /// # Design
    ///
    /// ## Helper path (via registered ExecutorHelper):
    ///
    /// The executor helper calls `executor.require_auth()` then delegates to the OApp.
    /// Auth contexts have 2-3 entries depending on whether value == 0:
    /// - Context 1: helper function (e.g., `execute`, `compose`) on the registered helper address
    /// - Context 2: `lz_receive`/`lz_compose` on the OApp/Composer (always present)
    /// - Context 3: `transfer` on native token (only if value != 0)
    ///
    /// ## Alert path:
    ///
    /// `lz_receive_alert`/`lz_compose_alert` are called directly on the endpoint
    /// to record failed executions. Only 1 context on the endpoint is expected.
    fn validate_auth_contexts(env: &Env, contexts: &Vec<Context>) -> Result<(), ExecutorError> {
        // Early bounds check: max 3 contexts expected (helper fn + lz_receive/lz_compose + optional transfer)
        if contexts.len() > 3 {
            return Err(ExecutorError::UnauthorizedContext);
        }

        let first_ctx = contexts.first().ok_or(ExecutorError::UnauthorizedContext)?;
        let Context::Contract(first_ctx) = first_ctx else {
            return Err(ExecutorError::UnauthorizedContext);
        };

        let first_fn_name = &first_ctx.fn_name;

        // Alert path: lz_receive_alert or lz_compose_alert
        if *first_fn_name == Symbol::new(env, "lz_receive_alert")
            || *first_fn_name == Symbol::new(env, "lz_compose_alert")
        {
            // Require exactly 1 context and the contract must be the endpoint
            if contexts.len() != 1 || first_ctx.contract != Self::endpoint(env) {
                return Err(ExecutorError::UnauthorizedContext);
            }
            return Ok(());
        }

        // Helper path: first context must be on the registered executor helper
        let helper_config =
            ExecutorStorage::executor_helper(env).ok_or(ExecutorError::UnauthorizedContext)?;

        // Validate first context: must be the helper address with an allowed function name
        if first_ctx.contract != helper_config.address
            || !helper_config.allowed_functions.contains(first_fn_name)
        {
            return Err(ExecutorError::UnauthorizedContext);
        }

        // Second context: must be lz_receive or lz_compose on the OApp/Composer
        let second_ctx = contexts.get(1).ok_or(ExecutorError::UnauthorizedContext)?;
        let Context::Contract(second_ctx) = second_ctx else {
            return Err(ExecutorError::UnauthorizedContext);
        };

        let second_fn_name = &second_ctx.fn_name;
        if *second_fn_name != Symbol::new(env, "lz_receive")
            && *second_fn_name != Symbol::new(env, "lz_compose")
        {
            return Err(ExecutorError::UnauthorizedContext);
        }

        // Extract value from the lz_receive/lz_compose args (last arg is value)
        let value = Self::extract_i128(env, second_ctx.args.last())?;
        if value == 0 {
            // No transfer expected - should be exactly 2 contexts
            if contexts.len() != 2 {
                return Err(ExecutorError::UnauthorizedContext);
            }
            return Ok(());
        }

        // value != 0: validate transfer context
        let third_ctx = contexts.get(2).ok_or(ExecutorError::UnauthorizedContext)?;
        let Context::Contract(third_ctx) = third_ctx else {
            return Err(ExecutorError::UnauthorizedContext);
        };

        let native_token = LayerZeroEndpointV2Client::new(env, &Self::endpoint(env)).native_token();
        let transfer_amount = Self::extract_i128(env, third_ctx.args.get(2))?;

        // Validate transfer context: must be transfer with matching value and native token contract
        if third_ctx.fn_name != Symbol::new(env, "transfer")
            || third_ctx.contract != native_token
            || transfer_amount != value
        {
            return Err(ExecutorError::UnauthorizedContext);
        }

        Ok(())
    }

    /// Extracts an i128 value from an optional Val.
    #[inline]
    fn extract_i128(env: &Env, val: Option<Val>) -> Result<i128, ExecutorError> {
        let val = val.ok_or(ExecutorError::UnauthorizedContext)?;
        i128::try_from_val(env, &val).map_err(|_| ExecutorError::UnauthorizedContext)
    }
}
