#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, token, Address, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VaultError {
    InsufficientBalance = 1,
    ZeroAmount = 2,
}

#[contracttype]
pub enum DataKey {
    Balance(Address),
    TokenAddress,
}

#[contract]
pub struct MockVault;

#[contractimpl]
impl MockVault {
    /// Initialize the vault with a token address
    pub fn initialize(env: Env, token_address: Address) {
        env.storage()
            .instance()
            .set(&DataKey::TokenAddress, &token_address);
    }

    /// Deposit tokens into the vault.
    /// This function requires authorization from the `from` address.
    /// It will trigger a sub-invocation to transfer tokens from `from` to the vault.
    ///
    /// When `from` is a OneSig contract, this creates a multi-call auth tree:
    /// - Call 1: vault.deposit (root call requiring onesig auth)  
    /// - Call 2: token.transfer (sub-call from vault to move tokens)
    pub fn deposit(env: Env, from: Address, amount: i128) -> Result<(), VaultError> {
        if amount <= 0 {
            return Err(VaultError::ZeroAmount);
        }

        // Require authorization from the depositor (this is the onesig account)
        from.require_auth();

        // Get the token address
        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenAddress)
            .expect("vault not initialized");

        // Transfer tokens from the depositor to the vault
        // This creates a sub-invocation that's part of the same auth tree
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&from, env.current_contract_address(), &amount);

        // Update the balance
        let current_balance: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Balance(from.clone()))
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::Balance(from), &(current_balance + amount));

        Ok(())
    }

    /// Withdraw tokens from the vault back to the owner
    pub fn withdraw(env: Env, to: Address, amount: i128) -> Result<(), VaultError> {
        if amount <= 0 {
            return Err(VaultError::ZeroAmount);
        }

        // Require authorization from the withdrawer
        to.require_auth();

        // Check balance
        let current_balance: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Balance(to.clone()))
            .unwrap_or(0);

        if current_balance < amount {
            return Err(VaultError::InsufficientBalance);
        }

        // Get the token address
        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenAddress)
            .expect("vault not initialized");

        // Transfer tokens from vault to withdrawer
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &to, &amount);

        // Update the balance
        env.storage()
            .instance()
            .set(&DataKey::Balance(to), &(current_balance - amount));

        Ok(())
    }

    /// Deposit two different amounts into the vault in a single call.
    /// Internally calls token.transfer twice with amount1 and amount2.
    /// Used to test that sub-invocation auth matching is by content, not by position.
    pub fn deposit_double(
        env: Env,
        from: Address,
        amount1: i128,
        amount2: i128,
    ) -> Result<(), VaultError> {
        if amount1 <= 0 || amount2 <= 0 {
            return Err(VaultError::ZeroAmount);
        }

        from.require_auth();

        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenAddress)
            .expect("vault not initialized");

        let token_client = token::Client::new(&env, &token_address);

        // Transfer 1: amount1
        token_client.transfer(&from, env.current_contract_address(), &amount1);
        // Transfer 2: amount2
        token_client.transfer(&from, env.current_contract_address(), &amount2);

        let current_balance: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Balance(from.clone()))
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::Balance(from),
            &(current_balance + amount1 + amount2),
        );

        Ok(())
    }

    /// Get the balance of an address in the vault
    pub fn balance(env: Env, address: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::Balance(address))
            .unwrap_or(0)
    }

    /// Deposit with an additional transfer to a recipient.
    /// This creates a multi-call scenario:
    /// - Call 1: vault.deposit_and_transfer (root call requiring onesig auth)
    /// - Call 2: token.transfer from onesig to vault (sub-call)
    /// - Call 3: token.transfer from onesig to recipient (sub-call)
    pub fn deposit_and_transfer(
        env: Env,
        from: Address,
        deposit_amount: i128,
        transfer_to: Address,
        transfer_amount: i128,
    ) -> Result<(), VaultError> {
        if deposit_amount <= 0 || transfer_amount <= 0 {
            return Err(VaultError::ZeroAmount);
        }

        // Require authorization from the sender (onesig account)
        from.require_auth();

        // Get the token address
        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenAddress)
            .expect("vault not initialized");

        let token_client = token::Client::new(&env, &token_address);

        // Transfer 1: deposit to vault
        token_client.transfer(&from, env.current_contract_address(), &deposit_amount);

        // Transfer 2: transfer to recipient
        token_client.transfer(&from, &transfer_to, &transfer_amount);

        // Update vault balance
        let current_balance: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Balance(from.clone()))
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::Balance(from), &(current_balance + deposit_amount));

        Ok(())
    }
}

mod test {
    #![cfg(test)]
    extern crate std;

    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{token::StellarAssetClient, Env};

    #[test]
    fn test_deposit() {
        let env = Env::default();
        env.mock_all_auths();

        // Deploy mock vault
        let vault_id = env.register(MockVault, ());
        let vault_client = MockVaultClient::new(&env, &vault_id);

        // Create and deploy a token
        let admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token_admin = StellarAssetClient::new(&env, &token_id.address());
        let token_client = token::Client::new(&env, &token_id.address());

        // Initialize vault with token
        vault_client.initialize(&token_id.address());

        // Create a user and mint tokens
        let user = Address::generate(&env);
        token_admin.mint(&user, &1000);

        // Deposit tokens
        vault_client.deposit(&user, &500);

        // Verify balances
        assert_eq!(vault_client.balance(&user), 500);
        assert_eq!(token_client.balance(&user), 500);
        assert_eq!(token_client.balance(&vault_id), 500);
    }

    #[test]
    fn test_deposit_and_transfer() {
        let env = Env::default();
        env.mock_all_auths();

        // Deploy mock vault
        let vault_id = env.register(MockVault, ());
        let vault_client = MockVaultClient::new(&env, &vault_id);

        // Create and deploy a token
        let admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token_admin = StellarAssetClient::new(&env, &token_id.address());
        let token_client = token::Client::new(&env, &token_id.address());

        // Initialize vault with token
        vault_client.initialize(&token_id.address());

        // Create users
        let sender = Address::generate(&env);
        let recipient = Address::generate(&env);

        // Mint tokens to sender
        token_admin.mint(&sender, &1000);

        // Deposit and transfer
        vault_client.deposit_and_transfer(&sender, &300, &recipient, &200);

        // Verify balances
        assert_eq!(vault_client.balance(&sender), 300); // Deposited to vault
        assert_eq!(token_client.balance(&sender), 500); // 1000 - 300 - 200
        assert_eq!(token_client.balance(&vault_id), 300); // Vault received deposit
        assert_eq!(token_client.balance(&recipient), 200); // Recipient received transfer
    }
}
