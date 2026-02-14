//! Fuzzable small byte array

use snforge_std::fuzzable::{Fuzzable, generate_arg};

#[derive(Drop, Serde, Debug, PartialEq, Clone, Default)]
pub(crate) struct SmallByteArray {
    pub ba: ByteArray,
}

/// Generate a random byte array - length `0` to `100`
pub(crate) impl FuzzableByteArray of Fuzzable<SmallByteArray> {
    fn blank() -> SmallByteArray {
        Default::default()
    }

    fn generate() -> SmallByteArray {
        let ba_len: u32 = generate_arg(0, 100);

        let mut ba = "";
        for _ in 0..ba_len {
            // Limit only to printable characters with ASCII codes 32-126
            let letter: u8 = generate_arg(32, 126);
            ba.append_byte(letter);
        }

        SmallByteArray { ba }
    }
}

/// Generate a random array of byte arrays
pub(crate) impl FuzzableByteArrayArray of Fuzzable<Array<SmallByteArray>> {
    fn blank() -> Array<SmallByteArray> {
        Default::default()
    }

    fn generate() -> Array<SmallByteArray> {
        let ba_len: u32 = generate_arg(0, 100);
        let mut ba = array![];
        for _ in 0..ba_len {
            ba.append(FuzzableByteArray::generate());
        }

        ba
    }
}

// A wrapper type around an array of SmallByteArray to help fuzzer argument parsing
#[derive(Drop, Serde, Debug, PartialEq, Clone, Default)]
pub(crate) struct SmallByteArrayList {
    pub arr: Array<SmallByteArray>,
}

pub(crate) impl FuzzableSmallByteArrayList of Fuzzable<SmallByteArrayList> {
    fn blank() -> SmallByteArrayList {
        Default::default()
    }

    fn generate() -> SmallByteArrayList {
        SmallByteArrayList { arr: FuzzableByteArrayArray::generate() }
    }
}
