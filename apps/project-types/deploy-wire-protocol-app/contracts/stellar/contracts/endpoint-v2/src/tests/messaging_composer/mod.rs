mod clear_compose;
mod compose_queue;
mod lz_compose_alert;
mod send_compose;

pub(crate) const MAX_COMPOSE_INDEX: u32 = u16::MAX as u32;
pub(crate) const RECEIVED_MESSAGE_HASH_BYTES: [u8; 32] =
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
