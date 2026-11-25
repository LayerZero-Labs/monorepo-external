import "MultiSig.spec";
import "ExecutorStore.spec";

using MockCallTarget as mockCallTarget;

methods {
    function seed() external returns(bytes32) envfree;
    function nonce() external returns(uint64) envfree;
    function encodeLeaf(uint64,OneSig.Call[]) external returns (bytes32) envfree;
    function verifyTransactionProof(bytes32,OneSig.Transaction) external envfree;
    function canExecuteTransaction(address) external returns (bool) envfree;

    unresolved external in OneSigHarness.executeTransaction(
        OneSig.Transaction,bytes32,uint256,bytes
    ) => DISPATCH [
        mockCallTarget._
    ] default HAVOC_ECF;
}

// REACHABILITY

use rule reachability;

// HOOKS

// INVARIANTS

// helper invariant for EnumerableSet
use invariant setInvariant;

/**
 * @title Threshold Safety Invariant
 * @notice Ensures the approval threshold never exceeds total number of signers
 * @dev This invariant maintains basic operational safety by preventing
 *      an impossible-to-reach approval threshold
 */
use invariant thresholdLeTotalSigners;

/**
 * @title Non-Zero Threshold Invariant
 * @notice Ensures the approval threshold is never set to zero
 * @dev Critical safety check to prevent approval deadlock or allow empty signatures.
 */
use invariant thresholdNotZero;

/**
 * @title Non-Zero Address Signer Invariant
 * @notice Ensures address(0) can never be a valid signer
 * @dev Prevents potential misconfiguration
 */
use invariant signerNotZero;

// helper invariant for EnumerableSet (executorSet)
use invariant executorSetInvariant;

/**
 * @title Non-Zero Address Executor Invariant
 * @notice Ensures address(0) can never be a valid executor
 * @dev Prevents potential misconfiguration
 */
use invariant executorNotZero;

// ACCESS CONTROL

/**
 * @title Signer Set Access Control Rule
 * @notice Verifies that any state changes to signers can only be made by the MultiSig itself.
 * @dev Checks two conditions:
 *      - Changes to total number of signers
 *      - Changes to individual signer status
 * @dev Both types of changes must come from:
 *      - The MultiSig contract itself (msg.sender == currentContract)
 *      - The setSigner function specifically
 */
use rule accessControlSignerSet;

/**
 * @title Threshold Access Control Rule
 * @notice Verifies that threshold changes can only be made by the MultiSig itself.
 * @dev Ensures any change to the threshold value:
 *      - Must come from the contract itself (msg.sender == currentContract)
 *      - Must be called through the setThreshold function
 */
use rule accessControlThreshold;

/**
 * @title Seed Access Control Rule
 * @notice Verifies that seed changes can only be made by the MultiSig itself.
 * @dev Ensures any change to the seed value:
 *      - Must come from the contract itself (msg.sender == currentContract)
 *      - Must be changed through the setSeed function
 */
rule accessControlSeed(
    env e,
    method f,
    calldataarg args
) {
    bytes32 seed_before = seed();

    f(e, args);

    bytes32 seed_after = seed();

    assert seed_after != seed_before => e.msg.sender == currentContract && f.selector == sig:setSeed(bytes32).selector;
}

/**
 * @title Executor Set Access Control Rule
 * @notice Verifies that any state changes to executors can only be made by the contract itself.
 * @dev Checks two conditions:
 *      - Changes to total number of executors
 *      - Changes to individual executor status
 * @dev Both types of changes must come from:
 *      - The contract itself (msg.sender == currentContract)
 *      - The setExecutor function specifically
 */
use rule accessControlExecutorSet;

/**
 * @title Executor Required Access Control Rule
 * @notice Verifies that executorRequired changes can only be made by the contract itself.
 * @dev Ensures any change to the executorRequired value:
 *      - Must come from the contract itself (msg.sender == currentContract)
 *      - Must be called through the setExecutorRequired function
 */
use rule accessControlExecutorRequired;

// STATE CHANGES

/**
 * @title Nonce Monotonicity Rule
 * @notice Verifies that transaction nonce only increases on successful execution
 * @dev Checks two properties:
 *      - Nonce increments by exactly 1 for executeTransaction
 *      - Nonce remains unchanged for all other operations
 */
rule nonceMonotonicity(
    env e,
    method f,
    calldataarg args
) {
    mathint nonce_before = nonce();

    f(e, args);

    mathint nonce_after = nonce();

    assert f.selector == sig:executeTransaction(OneSig.Transaction,bytes32,uint256,bytes).selector
        <=> nonce_before + 1 == nonce_after;
    assert f.selector != sig:executeTransaction(OneSig.Transaction,bytes32,uint256,bytes).selector
        <=> nonce_before  == nonce_after;
}

// FUNCTIONAL CORRECTNESS

/**
 * @title Set Threshold Correctness Rule
 * @notice Verifies that setThreshold correctly updates the threshold value
 * @dev Ensures the threshold state variable exactly matches the input value
 *      after a successful setThreshold operation
 */
use rule setThresholdCorrectness;

/**
 * @title Set Threshold Revert Conditions Rule
 * @notice Verifies that setThreshold reverts on invalid inputs
 * @dev Ensures setThreshold reverts when:
 *      - threshold is zero
 *      - threshold exceeds total signers
 *      - caller is not the contract itself
 *      - msg.value is non-zero
 */
use rule setThresholdReverts;

/**
 * @title Set Executor Correctness Rule
 * @notice Verifies correct state transitions when adding or removing executors
 * @dev Checks the following properties:
 *      - When adding (_active == true):
 *          - Executor must not exist before and must exist after
 *          - Executor must not be address(0)
 *          - Total executors increases by 1
 *      - When removing (_active == false):
 *          - Executor must exist before and must not exist after
 *          - Total executors decreases by 1
 *      - Other addresses remain unchanged
 */
use rule setExecutorCorrectness;

/**
 * @title Add Existing Executor Reverts Rule
 * @notice Verifies that adding an existing executor reverts
 * @dev Ensures setExecutor(executor, true) reverts when executor is already in the set
 */
use rule addExistingExecutorReverts;

/**
 * @title Remove Non-Executor Reverts Rule
 * @notice Verifies that removing a non-existent executor reverts
 * @dev Ensures setExecutor(executor, false) reverts when executor is not in the set
 */
use rule removeNonExecutorReverts;

/**
 * @title Set Executor Required Correctness Rule
 * @notice Verifies that setExecutorRequired correctly updates the executorRequired value
 * @dev Ensures the executorRequired state variable exactly matches the input value
 *      after a successful setExecutorRequired operation
 */
use rule setExecutorRequiredCorrectness;

/**
 * @title Can Execute Transaction Correctness Rule
 * @notice Verifies canExecuteTransaction returns correct authorization status
 * @dev Ensures that:
 *      - Returns true if executorRequired is false (permissionless)
 *      - Returns true if sender is an executor
 *      - Returns true if sender is a signer
 *      - Returns false otherwise
 */
rule canExecuteTransactionCorrectness(address sender) {
    bool result = canExecuteTransaction(sender);

    assert result <=> (!executorRequired() || isExecutor(sender) || isSigner(sender));
}

/**
 * @title Get Executors Length Consistency Rule
 * @notice Verifies that getExecutors() length matches totalExecutors()
 * @dev Ensures consistency between the array view and the count view
 */
use rule getExecutorsLengthConsistency;

/**
 * @title Signer Set State Transition Rule
 * @notice Verifies correct state transitions when adding or removing signers
 * @dev Checks the following properties:
 *      - When adding (_active == true):
 *          - Signer must not exist before and must exist after
 *          - Signer must not be address(0)
 *          - Total signers increases by 1
 *      - When removing (_active == false):
 *          - Signer must exist before and must not exist after
 *          - Total signers decreases by 1
 *      - Other addresses remain unchanged
 */
use rule setSignerCorrectness;

/**
 * @title Add Existing Signer Reverts Rule
 * @notice Verifies that adding an existing signer reverts
 * @dev Ensures setSigner(signer, true) reverts when signer is already in the set
 */
use rule addExistingSignerReverts;

/**
 * @title Remove Non-Signer Reverts Rule
 * @notice Verifies that removing a non-existent signer reverts
 * @dev Ensures setSigner(signer, false) reverts when signer is not in the set
 */
use rule removeNonSignerReverts;

/**
 * @title Remove Signer Threshold Constraint Rule
 * @notice Verifies that removing a signer reverts when it would break threshold constraint
 * @dev Ensures setSigner(signer, false) reverts when totalSigners == threshold
 */
use rule removeSignerRevertsWhenWouldBreakThreshold;

/**
 * @title Signature Order Verification Rule
 * @notice Verifies that recovered signers are in ascending order
 * @dev Ensures signatures are ordered by signer address
 *      to prevent signature reordering attacks
 */
use rule verifySignaturesCorrectness_order;

/**
 * @title Signature Length Verification Rule
 * @notice Verifies that signature byte length meets the minimum required size
 * @dev Ensures signature length is at least threshold * 65 bytes
 *      (65 bytes = r(32) + s(32) + v(1) for each signature)
 */
use rule verifySignaturesCorrectness_signatureLength;

/**
 * @title Signature Digest Uniqueness Rule
 * @notice Verifies that a signature set cannot be valid for different message digests
 * @dev Ensures signatures cannot be reused across different messages
 *      by requiring verification to revert for any different digest
 */
use rule verifySignaturesCorrectness_noCollision;

/**
 * @title Non-Empty Signature Verification Rule
 * @notice Ensures signatures being verified are non-empty
 * @dev Basic sanity check that prevents verification of empty signature sets
 */
use rule verifySignaturesCorrectness_signatureNotEmpty;

/**
 * @title Signature Uniqueness Rule
 * @notice Verifies that each signature corresponds to a unique signer
 * @dev Ensures that different indices recover different signers,
 *      preventing signature reuse attacks
 */
use rule verifySignaturesCorrectness_noSignatureReuse;

/**
 * @title Valid Signer Recovery Rule
 * @notice Verifies that all recovered addresses from signatures are valid signers
 * @dev Ensures that for any valid signature verification:
 *      - The recovered address at each index must be a registered signer
 */
use rule verifySignaturesCorrectness_validSigner;

/**
 * @title Invalid Signer Reversion Rule
 * @notice Verifies that transactions with signatures from non-signers are rejected
 * @dev Ensures the verification process reverts if any signature
 *      is from an address that is not a registered signer
 */
use rule verifySignaturesCorrectness_invalidSignerShouldRevert;

/**
 * @title Signature Verification Count Rule
 * @notice Verifies that at least threshold number of signatures are checked
 * @dev Ensures the ECDSA recover operation is called at least once
 *      per required signature based on the threshold
 */
use rule verifySignaturesCorrectness_signatureCheckCount;

/**
 * @title Custom Threshold Signature Verification Rule
 * @notice Verifies that verifyNSignatures correctly validates signers with custom threshold
 * @dev Ensures all recovered signers are valid when using a custom threshold value
 */
use rule verifyNSignaturesCustomThreshold;

/**
 * @title Zero Custom Threshold Reverts Rule
 * @notice Verifies that verifyNSignatures reverts when custom threshold is zero
 * @dev Ensures zero threshold is rejected even when passed explicitly
 */
use rule verifyNSignaturesZeroThresholdReverts;

/**
 * @title Get Signers Length Consistency Rule
 * @notice Verifies that getSigners() length matches totalSigners()
 * @dev Ensures consistency between the array view and the count view
 */
use rule getSignersLengthConsistency;

/**
 * @title Set Seed Correctness Rule
 * @notice Verifies that setSeed correctly updates the seed value
 * @dev Ensures the seed state variable exactly matches the input value
 *      after a successful setSeed operation
 */
rule setSeedCorrectness(
    env e,
    bytes32 _seed
) {
    setSeed(e, _seed);
    assert seed() == _seed;
}

/**
 * @title Merkle Root Expiry Rule
 * @notice Verifies that expired merkle roots cannot be used for transaction execution
 * @dev First shows a transaction can be executed before expiry,
 *      then proves the same transaction reverts after expiry using the same initial state
 */
rule merkleRootExpiryRule(
    env e1, env e2,
    OneSig.Transaction transaction,
    bytes32 root,
    uint256 expiry,
    bytes sigs
) {
    require e1.block.timestamp <= expiry;
    require e2.block.timestamp > expiry;

    // Store the state
    storage initState = lastStorage;

    // First execution at e1 (before expiry)
    executeTransaction(e1, transaction, root, expiry, sigs);

    // Try execution at e2 (after expiry) starting from the same state
    executeTransaction@withrevert(e2, transaction, root, expiry, sigs) at initState;

    assert lastReverted, "Expired merkle root should not be usable";
}

// NOTE: The following leafEncodingUniquenessRule_* rules operate on munged code
// (see munge-OneSig_abi_encode.patch) where abi.encodePacked is replaced with abi.encode
// to work around Certora prover hashing limitations. These rules therefore verify collision
// resistance for abi.encode (trivially injective), not the production abi.encodePacked.
// The production encoding abi.encodePacked(uint8, uint64, bytes32, uint64, abi.encode(_calls))
// is collision-resistant by construction: all fixed-size types precede a single variable-length
// tail (abi.encode(_calls)), but this property is not formally verified here.

/**
 * @title Leaf Encoding Uniqueness Rule (Nonce)
 * @notice Verifies that different nonces result in different merkle leaves
 * @dev Ensures nonce changes produce unique leaf hashes
 */
rule leafEncodingUniquenessRule_nonce(
    uint64 nonce1,
    uint64 nonce2,
    OneSig.Call[] calls
) {
    bytes32 leaf1 = encodeLeaf(nonce1, calls);
    bytes32 leaf2 = encodeLeaf(nonce2, calls);

    assert nonce1 != nonce2 <=> leaf1 != leaf2,
        "Different nonces must produce different leaves";
    satisfy nonce1 != nonce2;
}

/**
 * @title Leaf Encoding Uniqueness Rule (Target Address)
 * @notice Verifies that different target addresses result in different merkle leaves
 * @dev Compares Call arrays where the target address differs
 */
rule leafEncodingUniquenessRule_to(
    uint64 nonce,
    OneSig.Call[] calls1,
    OneSig.Call[] calls2
) {
    require calls1.length == 1 && calls2.length == 1;
    require calls1[0].value == calls2[0].value;
    require calls1[0].data == calls2[0].data;

    bytes32 leaf1 = encodeLeaf(nonce, calls1);
    bytes32 leaf2 = encodeLeaf(nonce, calls2);

    assert calls1[0].to != calls2[0].to <=> leaf1 != leaf2,
        "Different target addresses must produce different leaves";
    satisfy calls1[0].to != calls2[0].to;
}

/**
 * @title Leaf Encoding Uniqueness Rule (Value)
 * @notice Verifies that different values result in different merkle leaves
 * @dev Compares Call arrays where the value differs
 */
rule leafEncodingUniquenessRule_value(
    uint64 nonce,
    OneSig.Call[] calls1,
    OneSig.Call[] calls2
) {
    require calls1.length == 1 && calls2.length == 1;
    require calls1[0].to == calls2[0].to;
    require calls1[0].data == calls2[0].data;

    bytes32 leaf1 = encodeLeaf(nonce, calls1);
    bytes32 leaf2 = encodeLeaf(nonce, calls2);

    assert calls1[0].value != calls2[0].value <=> leaf1 != leaf2,
        "Different values must produce different leaves";
    satisfy calls1[0].value != calls2[0].value;
}

/**
 * @title Leaf Encoding Uniqueness Rule (Data)
 * @notice Verifies that different data result in different merkle leaves
 * @dev Compares Call arrays where the data differs
 */
rule leafEncodingUniquenessRule_data(
    uint64 nonce,
    OneSig.Call[] calls1,
    OneSig.Call[] calls2
) {
    require calls1.length == 1 && calls2.length == 1;
    require calls1[0].to == calls2[0].to;
    require calls1[0].value == calls2[0].value;

    bytes32 leaf1 = encodeLeaf(nonce, calls1);
    bytes32 leaf2 = encodeLeaf(nonce, calls2);

    assert calls1[0].data != calls2[0].data <=> leaf1 != leaf2,
        "Different data must produce different leaves";
    satisfy calls1[0].data != calls2[0].data;
}

/**
 * @title Leaf Encoding Uniqueness Rule (Calls Length)
 * @notice Verifies that different call array lengths result in different merkle leaves
 * @dev Ensures call array length changes produce unique leaf hashes
 */
rule leafEncodingUniquenessRule_callsLength(
    uint64 nonce,
    OneSig.Call[] calls1,
    OneSig.Call[] calls2
) {
    require calls1.length != calls2.length;

    bytes32 leaf1 = encodeLeaf(nonce, calls1);
    bytes32 leaf2 = encodeLeaf(nonce, calls2);

    assert leaf1 != leaf2, "Different call array lengths must produce different leaves";
    satisfy leaf1 != leaf2;
}

/**
 * @title Leaf Encoding Determinism Rule
 * @notice Verifies that leaf encoding is deterministic
 * @dev Ensures identical inputs produce identical leaf hashes
 */
rule leafEncoding_determinism(
    uint64 nonce1,
    OneSig.Call[] calls1
) {
    bytes32 leaf1 = encodeLeaf(nonce1, calls1);
    bytes32 leaf2 = encodeLeaf(nonce1, calls1);

    assert leaf1 == leaf2, "Identical transactions must have identical leaves";
}

/**
 * @title Transaction Execution Merkle Verification Rule
 * @notice Verifies that transaction execution properly validates merkle proofs
 * @dev Ensures transaction execution fails if either the merkle root verification
 *      or transaction proof verification fails
 */
rule executeTransactionCorrectness_merkleRootCheck(
    env e,
    OneSig.Transaction _transaction,
    bytes32 _merkleRoot,
    uint256 _expiry,
    bytes _signatures
) {
    ecrecoverAxioms();
    requireInvariant setInvariant();
    requireInvariant thresholdNotZero();
    requireInvariant thresholdLeTotalSigners();
    requireInvariant signerNotZero();

    require e.msg.value == 0;

    verifyMerkleRoot@withrevert(e, _merkleRoot, _expiry, _signatures);
    bool verifyMerkleRootReverted = lastReverted;

    verifyTransactionProof@withrevert(_merkleRoot, _transaction);
    bool verifyTransactionProofReverted = lastReverted;

    executeTransaction(e, _transaction, _merkleRoot, _expiry, _signatures);

    assert !verifyMerkleRootReverted && !verifyTransactionProofReverted;
}

/**
 * @title No Replay Attack Rule
 * @notice Verifies that the same transaction cannot be executed twice
 * @dev Proves that nonce increment prevents replay attacks
 */
rule noReplayAttack(
    env e1,
    env e2,
    OneSig.Transaction _transaction,
    bytes32 _merkleRoot,
    uint256 _expiry,
    bytes _signatures
) {
    // First execution succeeds
    executeTransaction(e1, _transaction, _merkleRoot, _expiry, _signatures);

    // Second execution with same parameters reverts (nonce has changed)
    executeTransaction@withrevert(e2, _transaction, _merkleRoot, _expiry, _signatures);

    assert lastReverted, "Same transaction cannot be executed twice";
}

/**
 * @title Transaction Proof Length Validation Rule
 * @notice Verifies that transaction proofs must be non-empty when root differs from leaf
 * @dev Ensures that:
 *      - Empty proofs are rejected when merkle root != leaf
 *      - Valid proofs can exist for non-matching root/leaf pairs
 */
rule verifyTransactionProofCorrectness_proofLength(
    env e,
    bytes32 merkleRoot,
    OneSig.Transaction transaction
) {
    ecrecoverAxioms();
    bytes32 leaf = encodeLeaf(nonce(), transaction.calls);

    require merkleRoot != leaf;

    mathint proofLength = transaction.proof.length;

    verifyTransactionProof@withrevert(e, merkleRoot, transaction);
    bool verifyTransactionProofReverted = lastReverted;

    assert proofLength == 0 => verifyTransactionProofReverted;
    satisfy proofLength != 0 && !verifyTransactionProofReverted;
}

/**
 * @title Merkle Root Expiry Validation Rule
 * @notice Verifies that merkle root verification enforces expiry timestamp
 * @dev Proves that:
 *      - Verification succeeds before expiry
 *      - Verification fails after expiry
 *      - Using same initial state for both cases
 */
rule verifyMerkleRootCorrectness_expiryCheck(
    env e1,
    env e2,
    bytes32 _merkleRoot,
    uint256 _expiry,
    bytes _signatures
) {
    ecrecoverAxioms();
    requireInvariant thresholdNotZero();
    requireInvariant thresholdLeTotalSigners();
    requireInvariant signerNotZero();

    require e1.block.timestamp <= _expiry;
    require e2.block.timestamp > _expiry;

    storage initState = lastStorage;

    verifyMerkleRoot(e1, _merkleRoot, _expiry,_signatures);

    verifyMerkleRoot@withrevert(e2, _merkleRoot, _expiry,_signatures) at initState;

    assert lastReverted;
}

/**
 * @title Seed Change Invalidation Rule
 * @notice Verifies that changing the seed invalidates previously valid merkle roots
 * @dev Proves that:
 *      - A valid merkle root becomes invalid after seed change
 *      - Only applies when new seed differs from old seed
 */
rule setSeedInvalidatesMerkleRoot(
    env e,
    env e_multisig,
    bytes32 _merkleRoot,
    uint256 _expiry,
    bytes _signatures,
    bytes32 newSeed
) {
    ecrecoverAxioms();
    requireInvariant thresholdLeTotalSigners();
    requireInvariant signerNotZero();

    require threshold() == 1;

    bytes32 seed_before = seed();
    verifyMerkleRoot(e, _merkleRoot, _expiry,_signatures);

    require newSeed != seed_before;

    setSeed(e_multisig, newSeed);

    verifyMerkleRoot@withrevert(e, _merkleRoot, _expiry,_signatures);

    assert lastReverted;
}
