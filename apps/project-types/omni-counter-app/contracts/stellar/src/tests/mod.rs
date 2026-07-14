use soroban_sdk::{
    testutils::{MockAuth, MockAuthInvoke},
    token::StellarAssetClient,
    Address, Env, IntoVal,
};

pub mod test_codec;
pub mod test_counter;
pub mod test_u256_ext;

pub fn mint_to(env: &Env, owner: &Address, native_token: &Address, to: &Address, amount: i128) {
    env.mock_auths(&[MockAuth {
        address: owner,
        invoke: &MockAuthInvoke {
            contract: native_token,
            fn_name: "mint",
            args: (to, amount).into_val(env),
            sub_invokes: &[],
        },
    }]);

    let sac = StellarAssetClient::new(env, native_token);
    sac.mint(to, &amount);
}
