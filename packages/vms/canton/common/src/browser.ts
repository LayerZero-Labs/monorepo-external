/**
 * Browser-safe Canton utilities.
 *
 * This entrypoint intentionally excludes the Canton ledger client and its Node-only
 * transport dependencies. It may be used by frontend packages that need address
 * helpers, deferred-value encoding, and signature utilities.
 */
export * from './address';
export * from './crypto';
export * from './daml-serde';
export * from './deferredValue';
