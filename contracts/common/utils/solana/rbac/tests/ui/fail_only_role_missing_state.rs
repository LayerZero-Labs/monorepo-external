use rbac::only_role;

enum TestRoleType {
    Manager,
}

#[only_role(role = TestRoleType::Manager, authority = authority)]
pub struct Protected;

fn main() {}
