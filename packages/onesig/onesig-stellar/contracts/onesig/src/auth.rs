use super::{OneSig, OneSigArgs, OneSigClient};
use crate::{
    eip712::build_signer_proof_digest, events::TransactionExecuted, interfaces::IExecutor,
    storage::OneSigStorage, Call, IOneSig, OneSigError, Sender, SignerAsExecutor,
    TransactionAuthData,
};
use common_macros::contract_impl;
use soroban_sdk::{
    assert_with_error,
    auth::{Context, CustomAccountInterface},
    crypto::Hash,
    panic_with_error, Bytes, BytesN, Env, Vec,
};
use utils::multisig::{self, MultiSig as _};

// ============================================================================
// Custom Account Interface Implementation
// ============================================================================

#[contract_impl]
impl CustomAccountInterface for OneSig {
    type Signature = TransactionAuthData;
    type Error = OneSigError;

    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        auth_data: Self::Signature,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Self::Error> {
        let call = Self::extract_single_self_call(&env, &auth_contexts);

        let TransactionAuthData {
            merkle_root,
            expiry,
            proof,
            signatures,
            sender,
        } = auth_data;

        let nonce = Self::nonce(&env);
        let leaf = Self::encode_leaf(&env, nonce, &call);

        Self::verify_sender(
            &env,
            &sender,
            &signature_payload.into(),
            &leaf,
            &merkle_root,
        );
        Self::verify_merkle_root(&env, &merkle_root, expiry, &signatures);
        assert_with_error!(
            &env,
            verify_merkle_proof(&env, &proof, &merkle_root, &leaf),
            OneSigError::InvalidProofOrNonce
        );

        // Increment the nonce
        OneSigStorage::set_nonce(&env, &(nonce + 1));

        // Publish the Executed event
        TransactionExecuted { merkle_root, nonce }.publish(&env);

        Ok(())
    }
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

impl OneSig {
    /// Extracts a single self-targeting contract call from auth_contexts.
    fn extract_single_self_call(env: &Env, auth_contexts: &Vec<Context>) -> Call {
        assert_with_error!(
            env,
            auth_contexts.len() == 1,
            OneSigError::InvalidAuthContext
        );
        let Context::Contract(ctx) = auth_contexts.get(0).unwrap() else {
            panic_with_error!(env, OneSigError::NonContractInvoke);
        };
        assert_with_error!(
            env,
            ctx.contract == env.current_contract_address(),
            OneSigError::InvalidAuthContext
        );
        Call {
            to: ctx.contract,
            func: ctx.fn_name,
            args: ctx.args,
            sub_invocations: Vec::new(env),
        }
    }

    /// Verifies the sender has permission to execute the transaction.
    fn verify_sender(
        env: &Env,
        sender: &Sender,
        signature_payload: &BytesN<32>,
        leaf_hash: &BytesN<32>,
        merkle_root: &BytesN<32>,
    ) {
        if !Self::executor_required(env) {
            return;
        }
        match sender {
            Sender::Executor(pubkey, signature) => {
                Self::verify_executor_permissions(env, pubkey, signature, signature_payload);
            }
            Sender::Signer(proof) => {
                Self::verify_signer_as_executor_permissions(
                    env,
                    signature_payload,
                    leaf_hash,
                    merkle_root,
                    proof,
                );
            }
            Sender::Permissionless => panic_with_error!(env, OneSigError::OnlyExecutorOrSigner),
        }
    }

    /// Verifies the sender is a registered executor with a valid signature.
    fn verify_executor_permissions(
        env: &Env,
        sender_key: &BytesN<32>,
        sender_signature: &BytesN<64>,
        signature_payload: &BytesN<32>,
    ) {
        assert_with_error!(
            env,
            Self::is_executor(env, sender_key),
            OneSigError::OnlyExecutorOrSigner
        );

        env.crypto().ed25519_verify(
            sender_key,
            &signature_payload.clone().into(),
            sender_signature,
        );
    }

    /// Verifies the signer-as-executor flow per the spec.
    fn verify_signer_as_executor_permissions(
        env: &Env,
        signature_payload: &BytesN<32>,
        leaf_hash: &BytesN<32>,
        merkle_root: &BytesN<32>,
        proof: &SignerAsExecutor,
    ) {
        // 1. `signer_proof_expiry` has not passed.
        assert_with_error!(
            env,
            env.ledger().timestamp() <= proof.signer_proof_expiry,
            OneSigError::SignerProofExpired
        );

        // 2. proving `delegate` actually signed the Soroban runtime payload.
        env.crypto().ed25519_verify(
            &proof.delegate,
            &signature_payload.clone().into(),
            &proof.delegate_proof,
        );

        // 3. The recovered secp256k1 address is a registered signer.
        let digest = build_signer_proof_digest(
            env,
            leaf_hash,
            merkle_root,
            &proof.delegate,
            proof.signer_proof_expiry,
        );
        let signer = multisig::recover_signer(env, &digest, &proof.signer_proof);
        assert_with_error!(
            env,
            Self::is_signer(env, &signer),
            OneSigError::OnlyExecutorOrSigner
        );
    }
}

/// Verifies merkle proof using commutative keccak256 pairing.
pub fn verify_merkle_proof(
    env: &Env,
    proof: &Vec<BytesN<32>>,
    root: &BytesN<32>,
    leaf: &BytesN<32>,
) -> bool {
    let mut computed_hash = leaf.clone();
    for proof_item in proof {
        // Sort hashes: smaller hash goes first
        let (left, right) = if computed_hash < proof_item {
            (computed_hash, proof_item)
        } else {
            (proof_item, computed_hash)
        };

        // Hash pair: keccak256(left || right)
        let mut pair: Bytes = left.into();
        pair.append(&right.into());
        computed_hash = env.crypto().keccak256(&pair).into();
    }
    computed_hash == *root
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::vec;

    /// Helper: compute keccak256 of the sorted concatenation of two 32-byte hashes.
    fn hash_pair(env: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
        let (left, right) = if a < b { (a, b) } else { (b, a) };
        let mut pair: Bytes = left.clone().into();
        pair.append(&right.clone().into());
        env.crypto().keccak256(&pair).into()
    }

    /// Helper: compute keccak256 of arbitrary bytes, returning a 32-byte leaf.
    fn keccak_leaf(env: &Env, data: &[u8]) -> BytesN<32> {
        let bytes = Bytes::from_slice(env, data);
        env.crypto().keccak256(&bytes).into()
    }

    // ========================================================================
    // Single leaf (empty proof) – the leaf itself is the root
    // ========================================================================

    #[test]
    fn test_single_leaf_valid() {
        let env = Env::default();
        let leaf = keccak_leaf(&env, b"leaf_a");
        let root = leaf.clone();
        let proof: Vec<BytesN<32>> = vec![&env];

        assert!(verify_merkle_proof(&env, &proof, &root, &leaf));
    }

    #[test]
    fn test_single_leaf_wrong_root() {
        let env = Env::default();
        let leaf = keccak_leaf(&env, b"leaf_a");
        let wrong_root = keccak_leaf(&env, b"wrong");
        let proof: Vec<BytesN<32>> = vec![&env];

        assert!(!verify_merkle_proof(&env, &proof, &wrong_root, &leaf));
    }

    // ========================================================================
    // Two-leaf tree – one sibling in proof
    // ========================================================================

    #[test]
    fn test_two_leaf_tree_left() {
        let env = Env::default();
        let leaf_a = keccak_leaf(&env, b"leaf_a");
        let leaf_b = keccak_leaf(&env, b"leaf_b");
        let root = hash_pair(&env, &leaf_a, &leaf_b);

        let proof: Vec<BytesN<32>> = vec![&env, leaf_b];
        assert!(verify_merkle_proof(&env, &proof, &root, &leaf_a));
    }

    #[test]
    fn test_two_leaf_tree_right() {
        let env = Env::default();
        let leaf_a = keccak_leaf(&env, b"leaf_a");
        let leaf_b = keccak_leaf(&env, b"leaf_b");
        let root = hash_pair(&env, &leaf_a, &leaf_b);

        let proof: Vec<BytesN<32>> = vec![&env, leaf_a];
        assert!(verify_merkle_proof(&env, &proof, &root, &leaf_b));
    }

    #[test]
    fn test_two_leaf_tree_commutativity() {
        let env = Env::default();
        let leaf_a = keccak_leaf(&env, b"leaf_a");
        let leaf_b = keccak_leaf(&env, b"leaf_b");

        // Root should be the same regardless of ordering
        assert_eq!(
            hash_pair(&env, &leaf_a, &leaf_b),
            hash_pair(&env, &leaf_b, &leaf_a),
        );
    }

    // ========================================================================
    // Four-leaf tree – two siblings in proof
    //
    //           root
    //          /    \
    //       h_ab    h_cd
    //       / \     / \
    //      A   B   C   D
    // ========================================================================

    #[test]
    fn test_four_leaf_tree() {
        let env = Env::default();
        let leaf_a = keccak_leaf(&env, b"leaf_a");
        let leaf_b = keccak_leaf(&env, b"leaf_b");
        let leaf_c = keccak_leaf(&env, b"leaf_c");
        let leaf_d = keccak_leaf(&env, b"leaf_d");

        let h_ab = hash_pair(&env, &leaf_a, &leaf_b);
        let h_cd = hash_pair(&env, &leaf_c, &leaf_d);
        let root = hash_pair(&env, &h_ab, &h_cd);

        // Prove leaf A: proof = [B, H(C,D)]
        let proof_a: Vec<BytesN<32>> = vec![&env, leaf_b.clone(), h_cd.clone()];
        assert!(verify_merkle_proof(&env, &proof_a, &root, &leaf_a));

        // Prove leaf C: proof = [D, H(A,B)]
        let proof_c: Vec<BytesN<32>> = vec![&env, leaf_d.clone(), h_ab.clone()];
        assert!(verify_merkle_proof(&env, &proof_c, &root, &leaf_c));

        // Prove leaf D: proof = [C, H(A,B)]
        let proof_d: Vec<BytesN<32>> = vec![&env, leaf_c.clone(), h_ab.clone()];
        assert!(verify_merkle_proof(&env, &proof_d, &root, &leaf_d));
    }

    // ========================================================================
    // Invalid proof scenarios
    // ========================================================================

    #[test]
    fn test_wrong_leaf_fails() {
        let env = Env::default();
        let leaf_a = keccak_leaf(&env, b"leaf_a");
        let leaf_b = keccak_leaf(&env, b"leaf_b");
        let root = hash_pair(&env, &leaf_a, &leaf_b);

        let fake_leaf = keccak_leaf(&env, b"fake");
        let proof: Vec<BytesN<32>> = vec![&env, leaf_b];
        assert!(!verify_merkle_proof(&env, &proof, &root, &fake_leaf));
    }

    #[test]
    fn test_wrong_proof_element_fails() {
        let env = Env::default();
        let leaf_a = keccak_leaf(&env, b"leaf_a");
        let leaf_b = keccak_leaf(&env, b"leaf_b");
        let root = hash_pair(&env, &leaf_a, &leaf_b);

        let bad_sibling = keccak_leaf(&env, b"bad");
        let proof: Vec<BytesN<32>> = vec![&env, bad_sibling];
        assert!(!verify_merkle_proof(&env, &proof, &root, &leaf_a));
    }

    #[test]
    fn test_extra_proof_element_fails() {
        let env = Env::default();
        let leaf_a = keccak_leaf(&env, b"leaf_a");
        let leaf_b = keccak_leaf(&env, b"leaf_b");
        let root = hash_pair(&env, &leaf_a, &leaf_b);

        let extra = keccak_leaf(&env, b"extra");
        let proof: Vec<BytesN<32>> = vec![&env, leaf_b, extra];
        assert!(!verify_merkle_proof(&env, &proof, &root, &leaf_a));
    }

    #[test]
    fn test_missing_proof_element_fails() {
        let env = Env::default();
        let leaf_a = keccak_leaf(&env, b"leaf_a");
        let leaf_b = keccak_leaf(&env, b"leaf_b");
        let leaf_c = keccak_leaf(&env, b"leaf_c");
        let leaf_d = keccak_leaf(&env, b"leaf_d");

        let h_ab = hash_pair(&env, &leaf_a, &leaf_b);
        let h_cd = hash_pair(&env, &leaf_c, &leaf_d);
        let root = hash_pair(&env, &h_ab, &h_cd);

        // Only provide one of the two required proof elements
        let proof: Vec<BytesN<32>> = vec![&env, leaf_b.clone()];
        assert!(!verify_merkle_proof(&env, &proof, &root, &leaf_a));
    }
}
