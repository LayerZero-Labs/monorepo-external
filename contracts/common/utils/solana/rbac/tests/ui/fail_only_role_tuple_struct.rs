use rbac::only_role;

enum TestRoleType {
    Manager,
}

#[only_role(role = TestRoleType::Manager, state = store, authority = authority)]
pub struct Protected(u8);

fn main() {}
