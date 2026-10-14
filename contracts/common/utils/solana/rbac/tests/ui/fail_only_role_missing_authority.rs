use rbac::only_role;

enum TestRoleType {
    Manager,
}

#[only_role(role = TestRoleType::Manager, state = store)]
pub struct Protected;

fn main() {}
