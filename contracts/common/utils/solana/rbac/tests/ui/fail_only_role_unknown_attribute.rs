use rbac::only_role;

enum TestRoleType {
    Manager,
}

#[only_role(role = TestRoleType::Manager, state = store, authority = authority, invalid_attr = Foo)]
pub struct Protected;

fn main() {}
