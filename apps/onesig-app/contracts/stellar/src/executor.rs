use super::{OneSig, OneSigArgs, OneSigClient};
use crate::{
    events::{ExecutorRequiredSet, ExecutorSet},
    interfaces::IExecutor,
    storage::OneSigStorage,
    OneSigError,
};
use common_macros::{contract_impl, only_auth};
use soroban_sdk::{assert_with_error, BytesN, Env, Vec};
use utils::option_ext::OptionExt;

#[contract_impl]
impl IExecutor for OneSig {
    /// Adds or removes an executor based on the `active` flag.
    #[only_auth]
    fn set_executor(env: &Env, executor: &BytesN<32>, active: bool) {
        if active {
            Self::add_executor(env, executor);
        } else {
            Self::remove_executor(env, executor);
        }
    }

    /// Sets whether an executor is required for transactions.
    #[only_auth]
    fn set_executor_required(env: &Env, required: bool) {
        Self::set_executor_required_internal(env, required);
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    /// Returns the list of all registered executors.
    fn get_executors(env: &Env) -> Vec<BytesN<32>> {
        OneSigStorage::executors(env)
    }

    /// Checks whether a given address is a registered executor.
    fn is_executor(env: &Env, executor: &BytesN<32>) -> bool {
        Self::get_executors(env).contains(executor)
    }

    /// Returns the total number of registered executors.
    fn total_executors(env: &Env) -> u32 {
        Self::get_executors(env).len()
    }

    /// Returns whether an executor signature is required.
    fn executor_required(env: &Env) -> bool {
        OneSigStorage::executor_required(env)
    }
}

// ============================================================================
// Internal Functions
// ============================================================================

impl OneSig {
    /// Initializes the executor list and required flag. Can only be called once.
    pub(super) fn init_executor(env: &Env, executors: &Vec<BytesN<32>>, executor_required: bool) {
        assert_with_error!(
            env,
            !OneSigStorage::has_executors(env),
            OneSigError::ExecutorAlreadyInitialized
        );

        executors
            .iter()
            .for_each(|executor| Self::add_executor(env, &executor));
        Self::set_executor_required_internal(env, executor_required);
    }

    /// Adds a new executor, panics if it already exists, and emits an event.
    fn add_executor(env: &Env, executor: &BytesN<32>) {
        let mut executors = OneSigStorage::executors(env);
        assert_with_error!(
            env,
            !executors.contains(executor),
            OneSigError::ExecutorAlreadyExists
        );
        executors.push_back(executor.clone());
        OneSigStorage::set_executors(env, &executors);

        ExecutorSet {
            executor: executor.clone(),
            active: true,
        }
        .publish(env);
    }

    /// Removes an existing executor, panics if not found, and emits an event.
    fn remove_executor(env: &Env, executor: &BytesN<32>) {
        let mut executors = OneSigStorage::executors(env);
        let index = executors
            .first_index_of(executor)
            .unwrap_or_panic(env, OneSigError::ExecutorNotFound);
        executors.remove(index);
        OneSigStorage::set_executors(env, &executors);

        ExecutorSet {
            executor: executor.clone(),
            active: false,
        }
        .publish(env);
    }

    /// Updates the executor-required flag in storage and emits an event.
    fn set_executor_required_internal(env: &Env, required: bool) {
        OneSigStorage::set_executor_required(env, &required);
        ExecutorRequiredSet { required }.publish(env);
    }
}

#[cfg(test)]
mod test {
    use super::*;

    impl OneSig {
        /// Test-only wrapper for init_executor.
        pub fn init_executor_for_test(
            env: &Env,
            executors: &Vec<BytesN<32>>,
            executor_required: bool,
        ) {
            Self::init_executor(env, executors, executor_required);
        }
    }
}
