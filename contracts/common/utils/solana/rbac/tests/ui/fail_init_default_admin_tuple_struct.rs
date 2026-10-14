use rbac::init_default_admin;

enum TestRoleType {
    DefaultAdmin,
}

#[init_default_admin(state = state, role_type = TestRoleType, payer = authority, admin = authority.key())]
pub struct Initialize(u8);

fn main() {}
