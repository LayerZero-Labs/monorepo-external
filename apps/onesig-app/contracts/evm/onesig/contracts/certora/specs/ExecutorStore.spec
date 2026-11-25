methods {
    function executorRequired() external returns (bool) envfree;
    function getExecutors() external returns (address[] memory) envfree;
    function isExecutor(address) external returns (bool) envfree;
    function totalExecutors() external returns (uint256) envfree;

    function getExecutor(uint256) external returns (address) envfree;
}

// GHOSTS

persistent ghost mapping(mathint => bytes32) ghostExecutorValues {
    init_state axiom forall mathint x. ghostExecutorValues[x] == to_bytes32(0);
}
persistent ghost mapping(bytes32 => uint256) ghostExecutorIndexes {
    init_state axiom forall bytes32 x. ghostExecutorIndexes[x] == 0;
}
persistent ghost uint256 ghostExecutorLength {
    init_state axiom ghostExecutorLength == 0;
    // assumption: it's infeasible to grow the list to these many elements.
    axiom ghostExecutorLength < max_uint256;
}

// HOOKS

hook Sstore currentContract.executorSet._inner._values.length uint256 newLength {
    ghostExecutorLength = newLength;
}

hook Sstore currentContract.executorSet._inner._values[INDEX uint256 index] bytes32 newValue {
    ghostExecutorValues[index] = newValue;
}
hook Sstore currentContract.executorSet._inner._positions[KEY bytes32 value] uint256 newIndex {
    ghostExecutorIndexes[value] = newIndex;
}

hook Sload uint256 length currentContract.executorSet._inner._values.length {
    require ghostExecutorLength == length;
}
hook Sload bytes32 value currentContract.executorSet._inner._values[INDEX uint256 index] {
    require ghostExecutorValues[index] == value;
}
hook Sload uint256 index currentContract.executorSet._inner._positions[KEY bytes32 value] {
    require ghostExecutorIndexes[value] == index;
}

// INVARIANTS

// helper invariant for EnumerableSet (executorSet)
invariant executorSetInvariant()
    (forall uint256 index. 0 <= index && index < ghostExecutorLength => to_mathint(ghostExecutorIndexes[ghostExecutorValues[index]]) == index + 1)
    && (forall bytes32 value. ghostExecutorIndexes[value] == 0 ||
         (ghostExecutorValues[ghostExecutorIndexes[value] - 1] == value && ghostExecutorIndexes[value] >= 1 && ghostExecutorIndexes[value] <= ghostExecutorLength));

/**
 * @title Non-Zero Address Executor Invariant
 * @notice Ensures address(0) can never be a valid executor
 * @dev Prevents potential misconfiguration
 */
invariant executorNotZero()
    !isExecutor(0)
    {
        preserved {
            requireInvariant executorSetInvariant();
        }
    }

// ACCESS CONTROL

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
rule accessControlExecutorSet(
    env e,
    method f,
    calldataarg args,
    address anyAddress
) {
    mathint numberOfExecutors_before = totalExecutors();
    bool isExecutor_before = isExecutor(anyAddress);

    f(e, args);

    mathint numberOfExecutors_after = totalExecutors();
    bool isExecutor_after = isExecutor(anyAddress);

    assert (
        numberOfExecutors_after != numberOfExecutors_before ||
        isExecutor_after != isExecutor_before
    ) => (
        e.msg.sender == currentContract && f.selector == sig:setExecutor(address,bool).selector
    );
}

/**
 * @title Executor Required Access Control Rule
 * @notice Verifies that executorRequired changes can only be made by the contract itself.
 * @dev Ensures any change to the executorRequired value:
 *      - Must come from the contract itself (msg.sender == currentContract)
 *      - Must be called through the setExecutorRequired function
 */
rule accessControlExecutorRequired(
    env e,
    method f,
    calldataarg args
) {
    bool executorRequired_before = executorRequired();

    f(e, args);

    bool executorRequired_after = executorRequired();

    assert executorRequired_after != executorRequired_before =>
        e.msg.sender == currentContract && f.selector == sig:setExecutorRequired(bool).selector;
}

// FUNCTIONAL CORRECTNESS

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
rule setExecutorCorrectness(
    env e,
    address _executor,
    bool _active,
    address otherAddress
) {
    requireInvariant executorSetInvariant();

    require otherAddress != _executor;

    bool isExecutor_before = isExecutor(_executor);
    mathint numberOfExecutors_before = totalExecutors();
    bool otherIsExecutor_before = isExecutor(otherAddress);

    setExecutor(e, _executor, _active);

    bool isExecutor_after = isExecutor(_executor);
    mathint numberOfExecutors_after = totalExecutors();
    bool otherIsExecutor_after = isExecutor(otherAddress);

    assert  _active => !isExecutor_before && isExecutor_after;
    assert  _active => numberOfExecutors_after == numberOfExecutors_before + 1;
    assert  _active => _executor != 0;
    assert !_active => isExecutor_before && !isExecutor_after;
    assert !_active => numberOfExecutors_after == numberOfExecutors_before - 1;
    assert otherIsExecutor_after == otherIsExecutor_before;
    satisfy _active;
    satisfy !_active;
}

/**
 * @title Add Existing Executor Reverts Rule
 * @notice Verifies that adding an existing executor reverts
 * @dev Ensures setExecutor(executor, true) reverts when executor is already in the set
 */
rule addExistingExecutorReverts(env e, address executor) {
    require isExecutor(executor);

    setExecutor@withrevert(e, executor, true);

    assert lastReverted;
}

/**
 * @title Remove Non-Executor Reverts Rule
 * @notice Verifies that removing a non-existent executor reverts
 * @dev Ensures setExecutor(executor, false) reverts when executor is not in the set
 */
rule removeNonExecutorReverts(env e, address executor) {
    require !isExecutor(executor);

    setExecutor@withrevert(e, executor, false);

    assert lastReverted;
}

/**
 * @title Set Executor Required Correctness Rule
 * @notice Verifies that setExecutorRequired correctly updates the executorRequired value
 * @dev Ensures the executorRequired state variable exactly matches the input value
 *      after a successful setExecutorRequired operation
 */
rule setExecutorRequiredCorrectness(env e, bool _required) {
    setExecutorRequired(e, _required);
    assert executorRequired() == _required;
}

/**
 * @title Get Executors Length Consistency Rule
 * @notice Verifies that getExecutors() length matches totalExecutors()
 * @dev Ensures consistency between the array view and the count view
 */
rule getExecutorsLengthConsistency() {
    requireInvariant executorSetInvariant();

    address[] executors = getExecutors();
    assert executors.length == totalExecutors();
}
