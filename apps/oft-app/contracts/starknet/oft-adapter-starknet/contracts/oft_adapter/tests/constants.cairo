pub fn assert_eq<T, +PartialEq<T>, +Drop<T>>(a: T, b: T) {
    assert(a == b, 'Should be equal');
}
