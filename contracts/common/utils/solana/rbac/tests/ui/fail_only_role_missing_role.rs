use rbac::only_role;

#[only_role(state = store, authority = authority)]
pub struct Protected;

fn main() {}
