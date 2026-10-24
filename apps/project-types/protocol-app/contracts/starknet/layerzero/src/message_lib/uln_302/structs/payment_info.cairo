use crate::common::structs::messaging::Payee;

#[derive(Drop, Serde, PartialEq, Clone, Debug)]
pub struct DvnPaymentInfo {
    pub payees: Array<Payee>,
    pub total_native_fee: u256,
}
