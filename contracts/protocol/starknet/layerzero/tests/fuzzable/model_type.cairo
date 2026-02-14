//! Fuzzable model types

use layerzero::workers::price_feed::structs::ModelType;
use snforge_std::fuzzable::{Fuzzable, FuzzableU8};

/// Generate a random model type
pub(crate) impl FuzzableModelType of Fuzzable<ModelType> {
    fn generate() -> ModelType {
        const NUM_MODEL_TYPES: u8 = 3;
        let random = FuzzableU8::generate();

        match random % NUM_MODEL_TYPES {
            0 => ModelType::DEFAULT,
            1 => ModelType::OP_STACK,
            2 => ModelType::ARB_STACK,
            _ => {
                // This is unreachable
                assert(false, 'Invalid model type');
                ModelType::DEFAULT
            },
        }
    }

    fn blank() -> ModelType {
        ModelType::DEFAULT
    }
}
