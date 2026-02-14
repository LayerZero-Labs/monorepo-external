use core::num::traits::SaturatingSub;
use crate::constants::assert_eq;
use crate::fuzzable::felt_array::{Felt252ArrayList, FuzzableFelt252Array};

pub fn sort<T, +PartialOrd<T>, +Clone<T>, +Drop<T>>(mut xs: Array<T>) -> Array<T> {
    if let Some(pivot) = xs.pop_front() {
        let mut left = array![];
        let mut right = array![];
        let mut xs = xs.into_iter();

        for x in xs {
            if x.clone() < pivot.clone() {
                left.append(x);
            } else {
                right.append(x);
            }
        }

        sort(left).into_iter().chain(Some(pivot)).chain(sort(right)).collect()
    } else {
        xs
    }
}

#[test]
#[fuzzer(runs: 10)]
fn test_sort(list: Felt252ArrayList) {
    let xs = list.arr.into_iter().map(|x| x.into()).collect::<Array<u256>>();
    let ys = sort(xs.clone());

    assert_eq(ys.len(), xs.len());

    for x in xs {
        let mut iterator = ys.span().into_iter();

        assert(iterator.any(|y| *y == x), 'Element should be in the list');
    }

    for index in 0..ys.len().saturating_sub(1) {
        assert(ys[index] <= ys[index + 1], 'Elements should be sorted');
    }
}
