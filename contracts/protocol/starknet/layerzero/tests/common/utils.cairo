//! Common utils for testing

use layerzero::common::structs::messaging::MessageReceipt;

pub fn total_native_fee_from_receipt(receipt: @MessageReceipt) -> u256 {
    let mut total_native_fee: u256 = 0;

    for payee in receipt.payees {
        total_native_fee += *payee.native_amount;
    }

    total_native_fee
}

pub fn total_lz_fee_from_receipt(receipt: @MessageReceipt) -> u256 {
    let mut total_lz_fee: u256 = 0;

    for payee in receipt.payees {
        total_lz_fee += *payee.lz_token_amount;
    }

    total_lz_fee
}
