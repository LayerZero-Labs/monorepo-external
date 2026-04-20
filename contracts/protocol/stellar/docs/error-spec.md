# Stellar LayerZero Protocol - Error Code Specification

This document defines the error code allocation strategy for the Stellar LayerZero contracts.

## Purpose

Each library has a unique error code range to:

- **Prevent collisions**: Avoid error code conflicts between different libraries
- **Enable traceability**: Quickly identify which library an error originated from based on its code
- **Simplify debugging**: Error codes are globally unique, making it easier to track and diagnose issues

## Allocation Rules

- **Contract-specific errors**: Each contract uses auto-incrementing error codes starting from 1. These are local to the contract and do not need global uniqueness since the contract address provides context.
- **Library errors**: Libraries that are shared across multiple contracts use reserved ranges (1000+) to ensure global uniqueness.
- **Library allocation**: Each library is allocated a 100-unit block (e.g., 1000-1099, 1100-1199). Total errors in one library should not exceed 100.
- **Sub-range allocation**: Each error type within a library is allocated a 10-unit block. If an error type exceeds 10 errors, it extends into the next block but the following error type should start at the next 10-unit boundary.
- **Auto-increment**: Within each error enum, values auto-increment from the starting value.

## Error Code Ranges

### Contract-Specific Errors (1-999)

Contract-specific errors auto-increment from 1 and are scoped to each contract.

| Contract          | Location                                        |
| ----------------- | ----------------------------------------------- |
| EndpointV2        | `endpoint-v2/src/errors.rs`                     |
| ULN302            | `message-libs/uln-302/src/errors.rs`            |
| Treasury          | `message-libs/treasury/src/errors.rs`           |
| SimpleMessageLib  | `message-libs/simple-message-lib/src/errors.rs` |
| DVN               | `workers/dvn/src/errors.rs`                     |
| Executor          | `workers/executor/src/errors.rs`                |
| DVN Fee Lib       | `workers/dvn-fee-lib/src/errors.rs`             |
| Executor Fee Lib  | `workers/executor-fee-lib/src/errors.rs`        |
| Price Feed        | `workers/price-feed/src/errors.rs`              |
| LayerZero Views   | `layerzero-views/src/errors.rs`                 |
| Counter (example) | `oapps/counter/src/errors.rs`                   |

### Library Errors (1000+)

Libraries shared across contracts use reserved ranges for global uniqueness.

| Range     | Category     | Library            | Location                                        |
| --------- | ------------ | ------------------ | ----------------------------------------------- |
| 1000-1099 | Protocol Lib | utils              | `utils/src/errors.rs`                           |
| 1100-1199 | Protocol Lib | message-lib-common | `message-libs/message-lib-common/src/errors.rs` |
| 1200-1299 | Protocol Lib | worker             | `workers/worker/src/errors.rs`                  |
| 1300-1999 | Protocol Lib | (reserved)         | Future protocol libs                            |
| 2000-2099 | OApp Lib     | oapp               | `oapps/oapp/src/errors.rs`                      |
| 2100-2999 | OApp Lib     | (reserved)         | Future OApp libs                                |
| 3000-3099 | OFT Lib      | oft-core           | `oapps/oft-core/src/errors.rs`                  |
| 3100-3199 | OFT Lib      | oft (extensions)   | `oapps/oft/src/extensions/`                     |
| 3200-3999 | OFT Lib      | (reserved)         | Future OFT libs                                 |
