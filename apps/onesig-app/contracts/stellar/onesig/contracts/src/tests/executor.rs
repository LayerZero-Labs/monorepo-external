use super::helpers::{assert_latest_auth, create_onesig_for_executor_tests, new_executor_key};
use crate::{errors::OneSigError, OneSig};
use soroban_sdk::{testutils::Events, vec, Address, Env, IntoVal, Map, Symbol, Val};

fn setup<'a>() -> (Env, Address, crate::interfaces::ExecutorClient<'a>) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = create_onesig_for_executor_tests(&env);
    let executor_client = crate::interfaces::ExecutorClient::new(&env, &contract_id);

    (env, contract_id, executor_client)
}

#[test]
fn test_set_executor() {
    let (env, _contract_id, executor_client) = setup();

    let executor = new_executor_key(&env);

    // Add executor
    executor_client.set_executor(&executor, &true);

    // Verify executor was added
    assert!(executor_client.is_executor(&executor));
    assert_eq!(executor_client.total_executors(), 1);

    // Remove executor
    executor_client.set_executor(&executor, &false);

    // Verify executor was removed
    assert!(!executor_client.is_executor(&executor));
    assert_eq!(executor_client.total_executors(), 0);
}

#[test]
fn test_set_executor_auth_verification() {
    let (env, contract_id, executor_client) = setup();

    let executor = new_executor_key(&env);

    executor_client.set_executor(&executor, &true);

    assert_latest_auth(
        &env,
        &contract_id,
        "set_executor",
        (&executor, true).into_val(&env),
    );

    executor_client.set_executor(&executor, &false);

    assert_latest_auth(
        &env,
        &contract_id,
        "set_executor",
        (&executor, false).into_val(&env),
    );
}

#[test]
fn test_executor_required_default() {
    let (_env, _contract_id, executor_client) = setup();

    // Initially should be false (permissionless)
    assert!(!executor_client.executor_required());
}

#[test]
fn test_set_executor_required_without_executors() {
    let (_env, _contract_id, executor_client) = setup();

    executor_client.set_executor_required(&true);
    assert!(executor_client.executor_required());

    executor_client.set_executor_required(&false);
    assert!(!executor_client.executor_required());
}

#[test]
fn test_set_executor_required_auth_verification() {
    let (env, contract_id, executor_client) = setup();

    let executor = new_executor_key(&env);
    executor_client.set_executor(&executor, &true);

    executor_client.set_executor_required(&true);

    assert_latest_auth(
        &env,
        &contract_id,
        "set_executor_required",
        (true,).into_val(&env),
    );
}

#[test]
fn test_set_executor_required_with_executors() {
    let (env, _contract_id, executor_client) = setup();

    // Add an executor first
    let executor = new_executor_key(&env);
    executor_client.set_executor(&executor, &true);

    // Now can set required to true
    executor_client.set_executor_required(&true);
    assert!(executor_client.executor_required());

    // Can set back to false
    executor_client.set_executor_required(&false);
    assert!(!executor_client.executor_required());
}

#[test]
fn test_set_executor_duplicate() {
    let (env, _contract_id, executor_client) = setup();

    let executor = new_executor_key(&env);

    // Add executor first time
    executor_client.set_executor(&executor, &true);

    // Try to add again
    let res = executor_client.try_set_executor(&executor, &true);
    assert_eq!(
        res.err().unwrap().ok().unwrap(),
        OneSigError::ExecutorAlreadyExists.into()
    );
}

#[test]
fn test_remove_executor_not_found() {
    let (env, _contract_id, executor_client) = setup();

    let executor = new_executor_key(&env);

    // Try to remove executor that doesn't exist
    let res = executor_client.try_set_executor(&executor, &false);
    assert_eq!(
        res.err().unwrap().ok().unwrap(),
        OneSigError::ExecutorNotFound.into()
    );
}

#[test]
fn test_remove_last_executor_when_required() {
    let (env, _contract_id, executor_client) = setup();

    let executor = new_executor_key(&env);
    executor_client.set_executor(&executor, &true);

    executor_client.set_executor_required(&true);
    executor_client.set_executor(&executor, &false);

    assert_eq!(executor_client.total_executors(), 0);
    assert!(executor_client.executor_required());
    assert!(executor_client.get_executors().is_empty());
}

#[test]
fn test_get_executors() {
    let (env, _contract_id, executor_client) = setup();

    // Initially should be empty
    let executors = executor_client.get_executors();
    assert_eq!(executors.len(), 0);

    // Add executors
    let executor1 = new_executor_key(&env);
    let executor2 = new_executor_key(&env);
    executor_client.set_executor(&executor1, &true);
    executor_client.set_executor(&executor2, &true);

    // Get executors
    let executors = executor_client.get_executors();
    assert_eq!(executors.len(), 2);
    assert!(executors.contains(&executor1));
    assert!(executors.contains(&executor2));

    // Remove one executor
    executor_client.set_executor(&executor1, &false);

    // Get executors again
    let executors = executor_client.get_executors();
    assert_eq!(executors.len(), 1);
    assert!(!executors.contains(&executor1));
    assert!(executors.contains(&executor2));
}

#[test]
fn test_executor_set_event_add() {
    let (env, contract_id, executor_client) = setup();

    let executor = new_executor_key(&env);

    // Add executor
    executor_client.set_executor(&executor, &true);

    // Verify executor_set event was emitted
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                contract_id.clone(),
                (Symbol::new(&env, "executor_set"), executor.clone()).into_val(&env),
                Map::<Symbol, Val>::from_array(
                    &env,
                    [(Symbol::new(&env, "active"), true.into_val(&env))]
                )
                .into_val(&env),
            ),
        ]
    );
}

#[test]
fn test_executor_set_event_remove() {
    let (env, contract_id, executor_client) = setup();

    let executor = new_executor_key(&env);

    // Add executor first
    executor_client.set_executor(&executor, &true);

    // Remove executor
    executor_client.set_executor(&executor, &false);

    // Verify executor_set event (remove) was emitted
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                contract_id.clone(),
                (Symbol::new(&env, "executor_set"), executor.clone()).into_val(&env),
                Map::<Symbol, Val>::from_array(
                    &env,
                    [(Symbol::new(&env, "active"), false.into_val(&env))]
                )
                .into_val(&env),
            ),
        ]
    );
}

#[test]
fn test_executor_required_set_event() {
    let (env, contract_id, executor_client) = setup();

    // Add executor first
    let executor = new_executor_key(&env);
    executor_client.set_executor(&executor, &true);

    // Set executor_required to true
    executor_client.set_executor_required(&true);

    // Verify executor_required_set event was emitted
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                contract_id.clone(),
                (Symbol::new(&env, "executor_required_set"),).into_val(&env),
                Map::<Symbol, Val>::from_array(
                    &env,
                    [(Symbol::new(&env, "required"), true.into_val(&env)),]
                )
                .into_val(&env),
            ),
        ]
    );
}

#[test]
fn test_is_executor_success() {
    let (env, _contract_id, executor_client) = setup();

    // Create multiple executors
    let executor1 = new_executor_key(&env);
    let executor2 = new_executor_key(&env);
    let executor3 = new_executor_key(&env);
    let non_executor = new_executor_key(&env);

    // Add executors
    executor_client.set_executor(&executor1, &true);
    executor_client.set_executor(&executor2, &true);
    executor_client.set_executor(&executor3, &true);

    // Check existing executors
    assert!(executor_client.is_executor(&executor1));
    assert!(executor_client.is_executor(&executor2));
    assert!(executor_client.is_executor(&executor3));

    // Check non-existing executor
    assert!(!executor_client.is_executor(&non_executor));

    // Remove executor1
    executor_client.set_executor(&executor1, &false);

    // Check removed executor
    assert!(!executor_client.is_executor(&executor1));
    assert!(executor_client.is_executor(&executor2));
    assert!(executor_client.is_executor(&executor3));
}

#[test]
fn test_total_executors_empty() {
    let (_env, _contract_id, executor_client) = setup();

    // Initially should be 0
    assert_eq!(executor_client.total_executors(), 0);
}

#[test]
fn test_total_executors_success() {
    let (env, _contract_id, executor_client) = setup();

    // Initially 0
    assert_eq!(executor_client.total_executors(), 0);

    // Add first executor
    let executor1 = new_executor_key(&env);
    executor_client.set_executor(&executor1, &true);
    assert_eq!(executor_client.total_executors(), 1);

    // Add second executor
    let executor2 = new_executor_key(&env);
    executor_client.set_executor(&executor2, &true);
    assert_eq!(executor_client.total_executors(), 2);

    // Add third executor
    let executor3 = new_executor_key(&env);
    executor_client.set_executor(&executor3, &true);
    assert_eq!(executor_client.total_executors(), 3);

    // Remove one executor
    executor_client.set_executor(&executor1, &false);
    assert_eq!(executor_client.total_executors(), 2);
}

#[test]
fn test_remove_all_executors_success() {
    let (env, _contract_id, executor_client) = setup();

    // Add multiple executors
    let executor1 = new_executor_key(&env);
    let executor2 = new_executor_key(&env);
    let executor3 = new_executor_key(&env);

    executor_client.set_executor(&executor1, &true);
    executor_client.set_executor(&executor2, &true);
    executor_client.set_executor(&executor3, &true);

    // Ensure executor_required is false (so we can remove all)
    executor_client.set_executor_required(&false);
    assert!(!executor_client.executor_required());

    // Remove all executors one by one
    executor_client.set_executor(&executor1, &false);
    assert_eq!(executor_client.total_executors(), 2);

    executor_client.set_executor(&executor2, &false);
    assert_eq!(executor_client.total_executors(), 1);

    executor_client.set_executor(&executor3, &false);
    assert_eq!(executor_client.total_executors(), 0);
    assert_eq!(executor_client.get_executors().len(), 0);
}

#[test]
fn test_executor_lifecycle() {
    let (env, _contract_id, executor_client) = setup();

    // Initial state
    assert_eq!(executor_client.total_executors(), 0);
    assert!(!executor_client.executor_required());

    // Add executors
    let executor1 = new_executor_key(&env);
    let executor2 = new_executor_key(&env);
    let executor3 = new_executor_key(&env);
    let executor4 = new_executor_key(&env);

    executor_client.set_executor(&executor1, &true);
    executor_client.set_executor(&executor2, &true);
    executor_client.set_executor(&executor3, &true);
    assert_eq!(executor_client.total_executors(), 3);
    assert!(!executor_client.executor_required());

    // Set executor_required to true
    executor_client.set_executor_required(&true);
    assert!(executor_client.executor_required());

    // Add a new executor
    executor_client.set_executor(&executor4, &true);
    assert_eq!(executor_client.total_executors(), 4);
    assert!(executor_client.is_executor(&executor4));

    // Remove an existing executor
    executor_client.set_executor(&executor1, &false);
    assert_eq!(executor_client.total_executors(), 3);
    assert!(!executor_client.is_executor(&executor1));

    // Change executor required setting back to false
    executor_client.set_executor_required(&false);
    assert!(!executor_client.executor_required());

    // Add back the removed executor
    executor_client.set_executor(&executor1, &true);
    assert_eq!(executor_client.total_executors(), 4);
    assert!(executor_client.is_executor(&executor1));
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")] // ExecutorAlreadyInitialized
fn test_init_executor_already_initialized() {
    use super::helpers::create_onesig_with_defaults;

    let env = Env::default();
    env.mock_all_auths();

    // Create contract WITH initial executors (so has_executors returns true)
    let initial_executor = new_executor_key(&env);
    let dummy_signer = soroban_sdk::BytesN::from_array(&env, &[1u8; 20]);
    let contract_id = create_onesig_with_defaults(
        &env,
        None,
        None,
        Some(vec![&env, dummy_signer]),
        Some(1u32),
        Some(vec![&env, initial_executor]),
        None,
    );

    // Try to call init_executor again - should fail with ExecutorAlreadyInitialized
    let new_executors = vec![&env, new_executor_key(&env)];
    env.as_contract(&contract_id, || {
        OneSig::init_executor_for_test(&env, &new_executors, false);
    });
}
