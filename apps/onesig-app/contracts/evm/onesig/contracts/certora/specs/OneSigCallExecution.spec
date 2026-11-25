/**
 * @title OneSig Call Execution Spec
 * @notice Dedicated spec for verifying call execution loop correctness
 * @dev Uses summary for verifyTransactionProof to avoid hashing complexity,
 *      allowing verification of the actual executeTransaction loop in OneSig.sol
 */

import "MultiSig.spec";
import "ExecutorStore.spec";

using MockCallTarget as mockCallTarget;
using FailingMockCallTarget as failingMockCallTarget;

methods {
    function seed() external returns(bytes32) envfree;
    function nonce() external returns(uint64) envfree;
    function encodeLeaf(uint64,OneSig.Call[]) external returns (bytes32) envfree;
    function canExecuteTransaction(address) external returns (bool) envfree;

    // Summary: Skip verifyTransactionProof to avoid heavy hashing with non-empty calls
    // This is sound for testing call execution since we're only verifying the loop behavior
    // Must be internal since it's called internally from executeTransaction
    function _.verifyTransactionProof(bytes32, OneSig.Transaction calldata) internal => NONDET;

    // Dispatch external calls to either succeeding or failing mock
    unresolved external in OneSigHarness.executeTransaction(
        OneSig.Transaction,bytes32,uint256,bytes
    ) => DISPATCH [
        mockCallTarget._,
        failingMockCallTarget._
    ] default NONDET;
}

// Ghost to count CALL operations
persistent ghost mathint ghostCallCount {
    init_state axiom ghostCallCount == 0;
}

// Ghost to track if any call failed (returned 0)
persistent ghost bool ghostCallFailed {
    init_state axiom ghostCallFailed == false;
}

// Ghost to track if any call succeeded (returned non-zero)
persistent ghost bool ghostCallSucceeded {
    init_state axiom ghostCallSucceeded == false;
}

// Ghost to track total ETH value forwarded across all CALLs
persistent ghost mathint ghostTotalValueForwarded {
    init_state axiom ghostTotalValueForwarded == 0;
}

hook CALL(uint g, address addr, uint value, uint argsOffset, uint argsLength, uint retOffset, uint retLength) uint rc {
    ghostCallCount = ghostCallCount + 1;
    ghostTotalValueForwarded = ghostTotalValueForwarded + value;
    // rc is the return value: 0 = call failed, non-zero = call succeeded
    if (rc == 0) {
        ghostCallFailed = true;
    } else {
        ghostCallSucceeded = true;
    }
}

/**
 * @title Transaction Call Execution Correctness Rule
 * @notice Verifies that executeTransaction executes exactly calls.length CALL operations
 * @dev This rule catches mutations that would skip the execution loop
 *      (e.g., swapped loop condition `i < calls.length` → `calls.length < i`)
 */
rule executeTransactionCorrectness_calls(
    env e,
    OneSig.Transaction _transaction,
    bytes32 _merkleRoot,
    uint256 _expiry,
    bytes _signatures
) {
    require ghostCallCount == 0;
    mathint numberOfCalls = _transaction.calls.length;

    executeTransaction(e, _transaction, _merkleRoot, _expiry, _signatures);

    assert ghostCallCount == numberOfCalls,
        "Number of CALL operations must equal number of calls in transaction";
    satisfy ghostCallCount == numberOfCalls && ghostCallCount >= 1;
}

/**
 * @title Non-Empty Transaction Must Execute Calls Rule
 * @notice Verifies that transactions with calls actually execute at least one call
 * @dev Directly catches the SwapArgumentsOperatorMutation where loop never executes
 */
rule executeTransactionMustExecuteCalls(
    env e,
    OneSig.Transaction _transaction,
    bytes32 _merkleRoot,
    uint256 _expiry,
    bytes _signatures
) {
    require ghostCallCount == 0;
    require _transaction.calls.length >= 1;

    executeTransaction(e, _transaction, _merkleRoot, _expiry, _signatures);

    assert ghostCallCount >= 1,
        "Transaction with calls must execute at least one CALL";
}

/**
 * @title Call Value Forwarding Correctness Rule
 * @notice Verifies that executeTransaction forwards the correct ETH value
 * @dev Scoped to single-call transactions for tractability.
 *      Catches mutations that would zero out or alter the forwarded value.
 */
rule executeTransactionCorrectness_valueForwarding(
    env e,
    OneSig.Transaction _transaction,
    bytes32 _merkleRoot,
    uint256 _expiry,
    bytes _signatures
) {
    require ghostTotalValueForwarded == 0;
    require _transaction.calls.length == 1;

    executeTransaction(e, _transaction, _merkleRoot, _expiry, _signatures);

    assert ghostTotalValueForwarded == _transaction.calls[0].value,
        "Forwarded value must match the call's specified value";
    satisfy _transaction.calls[0].value > 0;
}

/**
 * @title Execute Transaction Access Control Rule
 * @notice Verifies that executeTransaction respects onlyExecutorOrSigner modifier
 * @dev Ensures that when executorRequired is true:
 *      - Only executors or signers can execute transactions
 *      - Non-authorized callers are rejected
 */
rule executeTransactionAccessControl(
    env e,
    OneSig.Transaction _transaction,
    bytes32 _merkleRoot,
    uint256 _expiry,
    bytes _signatures
) {
    require executorRequired();
    bool isExecutorVal = isExecutor(e.msg.sender);
    bool isSignerVal = isSigner(e.msg.sender);

    executeTransaction@withrevert(e, _transaction, _merkleRoot, _expiry, _signatures);
    bool executeTransactionReverted = lastReverted;

    satisfy isExecutorVal && !isSignerVal && !executeTransactionReverted;
    satisfy isSignerVal && !isExecutorVal && !executeTransactionReverted;
    assert (!isExecutorVal && !isSignerVal) => executeTransactionReverted;
}

/**
 * @title Failed Call Must Revert Rule
 * @notice Verifies that if an external call fails, executeTransaction reverts
 * @dev Catches mutation: `if (!success)` → `if (false)` which would ignore failed calls
 *      Uses ghost tracking to detect when a call fails
 */
rule failedCallMustRevert(
    env e,
    OneSig.Transaction _transaction,
    bytes32 _merkleRoot,
    uint256 _expiry,
    bytes _signatures
) {
    require ghostCallFailed == false;
    require _transaction.calls.length >= 1;

    executeTransaction@withrevert(e, _transaction, _merkleRoot, _expiry, _signatures);

    // If any call failed, the transaction must have reverted
    assert ghostCallFailed => lastReverted,
        "Transaction must revert if any call fails";
    satisfy ghostCallFailed && lastReverted;
}

/**
 * @title Successful Call Can Complete Rule
 * @notice Verifies that executeTransaction can complete when calls succeed
 * @dev Catches mutation: `if (!success)` → `if (true)` which would always revert
 *      Uses ghost tracking to verify successful calls don't cause revert
 */
rule successfulCallCanComplete(
    env e,
    OneSig.Transaction _transaction,
    bytes32 _merkleRoot,
    uint256 _expiry,
    bytes _signatures
) {
    require ghostCallSucceeded == false;
    require ghostCallFailed == false;
    require _transaction.calls.length >= 1;

    executeTransaction(e, _transaction, _merkleRoot, _expiry, _signatures);

    // If transaction completed and a call was made, the call must have succeeded
    // (With mutation `if (true)`, this would never be satisfiable since it always reverts)
    satisfy ghostCallSucceeded && !ghostCallFailed;
}
