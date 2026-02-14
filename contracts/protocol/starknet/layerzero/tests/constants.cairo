const EVENT_SIZE_LIMIT: usize = 300; // felts
pub const SENT_MESSAGE_SIZE_LIMIT: usize = (EVENT_SIZE_LIMIT - 9) * 31;
pub const ALERT_MESSAGE_SIZE_LIMIT: usize = (EVENT_SIZE_LIMIT - 11) * 31;
pub const SENT_COMPOSE_MESSAGE_SIZE_LIMIT: usize = (EVENT_SIZE_LIMIT - 4) * 31;
pub const ALERT_COMPOSE_MESSAGE_SIZE_LIMIT: usize = (EVENT_SIZE_LIMIT - 12) * 31;

pub fn assert_eq<T, +PartialEq<T>, +Drop<T>>(a: T, b: T) {
    assert(a == b, 'Should be equal');
}
