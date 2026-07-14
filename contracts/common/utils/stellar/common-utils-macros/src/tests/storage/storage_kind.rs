//! Unit tests for the `StorageKind` enum methods via wrapper functions.

use crate::storage::test::{
    storage_kind_instance_accessor, storage_kind_instance_name, storage_kind_persistent_accessor,
    storage_kind_persistent_name, storage_kind_temporary_accessor, storage_kind_temporary_name,
};

#[test]
fn test_instance_name() {
    assert_eq!(storage_kind_instance_name(), "instance");
}

#[test]
fn test_persistent_name() {
    assert_eq!(storage_kind_persistent_name(), "persistent");
}

#[test]
fn test_temporary_name() {
    assert_eq!(storage_kind_temporary_name(), "temporary");
}

#[test]
fn test_instance_accessor() {
    let accessor = storage_kind_instance_accessor();
    assert_eq!(accessor.to_string(), "env . storage () . instance ()");
}

#[test]
fn test_persistent_accessor() {
    let accessor = storage_kind_persistent_accessor();
    assert_eq!(accessor.to_string(), "env . storage () . persistent ()");
}

#[test]
fn test_temporary_accessor() {
    let accessor = storage_kind_temporary_accessor();
    assert_eq!(accessor.to_string(), "env . storage () . temporary ()");
}
