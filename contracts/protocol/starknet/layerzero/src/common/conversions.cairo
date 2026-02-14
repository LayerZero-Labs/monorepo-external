//! Common conversions

use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;

/// Converts felt252 arrays to byte arrays in the event data
pub impl FeltArrayIntoByteArrayImpl of Into<Array<felt252>, ByteArray> {
    fn into(self: Array<felt252>) -> ByteArray {
        let mut byte_array = Default::default();

        for felt in self.into_iter() {
            byte_array.append_felt252(felt);
        }

        byte_array
    }
}
