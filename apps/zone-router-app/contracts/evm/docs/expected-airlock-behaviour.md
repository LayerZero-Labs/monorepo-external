# Expected Airlock behaviour

This document describes Airlock at zero-evm-zone main [`67d78af856202b1f28a8ff248934e1466dafd59a`](https://github.com/LayerZero-Labs/zero-evm-zone/tree/67d78af856202b1f28a8ff248934e1466dafd59a), using its [interface][abi] and [guide][guide]. The zero-zone-core dependency in [Cargo.lock][lock] was not considered.

## Layer boundaries

Each layer relies on guarantees below it. The host must apply the protocol's effects atomically.

| Layer                 | Responsibility                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------- |
| Protocol STF          | Message encoding, channels, ordered nonces, authenticated remote reads and safe pruning.      |
| EVM precompile        | Caller identity, ABI validation, transaction proofs, journaling and native ZRO burns/credits. |
| Router implementation | Token settlement and peer policy, outside Airlock.                                            |
| Application contracts | Choose message contents and process returned messages.                                        |

See the [protocol and host description][guide] and [EVM integration][host].

## Precompile inputs and identity

The precompile is `0x0000000000000000000000000000000000000a1a`. Calls use structs and raw address bytes without length prefixes; Airlock owns the wire format. Airlock copies a generic amount (`amount18d`) unchanged, so its unit is whatever the channel's two applications agree on; this router uses 18 decimals, and its peers must too. Native amounts are wei. Airlock does not convert or check decimals, verify token backing or establish peer trust. See [IAirlock][abi].

The host supplies the local zone, which is the EVM chain id the zone executes under, and the direct caller's packed twenty-byte address as the local app. Receive calls are bound to the destination caller. The sending app supplies the generic `sender` field. See [call construction][adapter].

| Input or context | Current host/API rule                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Zone             | `uint64`, each zone's id from the beacon genesis. Zero is invalid (`InvalidPeerZone`). `send` and `sendZro` revert with `InactiveZone` for a zone `isActiveZone` reports inactive.               |
| Addresses        | Raw 1–255 bytes (`InvalidAddressLength`). Twenty-byte and padded thirty-two-byte values are different identities. EVM app channels use twenty bytes. Length does not prove an address is usable. |
| Memo             | Opaque, 0–255 bytes (`MemoTooLong`).                                                                                                                                                             |
| Value            | Only `sendZro` accepts value and burns exactly positive `msg.value`; zero is `ZeroAmount`. Generic amounts have no positive-amount check in the adapter.                                         |
| Call frame       | Delegated calls revert. `messageVersion` and `isActiveZone` support static calls.                                                                                                                |
| ABI              | Calls must be canonical. Unsupported selectors, invalid words/padding and trailing bytes revert with `UnsupportedCall`.                                                                          |

Only native operations may use the reserved ZRO application. See [validation and error mapping][adapter], [the ABI][abi] and [zone semantics][guide].

## Airlock interface assumptions

`isActiveZone(uint64) external view returns (bool)` supports static calls. Zone zero returns false, and any other zone is active only where the beacon registers it. Both `send` and `sendZro` reject inactive nonzero zones with `InactiveZone`; zero reverts with `InvalidPeerZone`. See [the adapter][adapter] and [the consumed interface](../contracts/interfaces/IAirlock.sol).

We assume the sequencer or block producer supplies complete and correct zone-registry proofs for the block's beacon dependency, without omitted or stale evidence that misrepresents `isActiveZone`. Under this assumption, both true and false results are trusted. [`isActiveZone`][abi] cryptographically proves only true results; trust in false results depends on this assumption.

## Delivery guarantees and host obligations

- Remote reads, including absence, must authenticate against the beacon dependency. Message zones and apps must match their channel.
- Proofs come from the transaction, not application calldata. The host checks their height.
- Receive accepts 1–64 consecutive messages at the current cursor. Replay, gaps, invalid proofs, malformed headers and nonce overflow must fail without writes.
- Pruning may remove payloads only below the destination's proven accepted cursor.
- Applications consume `Message` structs. The documented wire version is 1.
- Each `Message` carries its channel `nonce` after `dstApp`. Airlock encodes it into the payload and refuses a payload whose nonce is not the slot it was read from ([guide]), so a delivered message's nonce equals `firstNonce` plus its index in the batch.

See [protocol requirements][abi], [proof handling][adapter] and [the guide][guide].

The host stages cursor/outbox writes before returning control, so nested calls see the new state. Reverting a frame restores Airlock writes, balances and logs with EVM state. An out-of-gas Airlock call applies no effects. Native supply relies on each zone's host applying the required burn and credit with the protocol transition. See [journal and balance integration][host].

## Native credits, permissions and gas

`receiveZro` is permissionless. It credits twenty-byte recipients without running recipient code. Other accepted lengths consume the message without minting and emit `ZroUnclaimable`; the value remains burned. The adapter does not reject a twenty-byte zero address. See [native credit handling][adapter] and [balance application][host].

We assume `Airlock.send` admits only `ZoneRouter` proxies deployed by the canonical `ZoneRouterFactory`, as the [application specification](../../../../../docs/oapp-special-forces/zero-evm-zone-oft-spec.md#23-zonerouterfactory-predeploy) requires. The [adapter][adapter] enforces this through the zone's app registry: `send` and `receiveMessages` from a caller the registry does not list revert with `UnregisteredApp`. We assume each zone configures the factory as its app registry, as the [shipped genesis][genesis] does. The registry does not restrict permissionless native calls or proof-based pruning.

Gas prices are chain rules. Relayers must account for proof size, beacon-height admission and batch cost. Upstream documents incomplete proof/log pricing and a guest proof that binds the dependency root but not its height. See [gas rules][gas] and [upstream limitations][guide].

[abi]: https://github.com/LayerZero-Labs/zero-evm-zone/blob/67d78af856202b1f28a8ff248934e1466dafd59a/crates/core/airlock/sol/IAirlock.sol
[adapter]: https://github.com/LayerZero-Labs/zero-evm-zone/blob/67d78af856202b1f28a8ff248934e1466dafd59a/crates/core/airlock/src/call.rs
[host]: https://github.com/LayerZero-Labs/zero-evm-zone/blob/67d78af856202b1f28a8ff248934e1466dafd59a/crates/ethereum/evm/src/airlock.rs
[gas]: https://github.com/LayerZero-Labs/zero-evm-zone/blob/67d78af856202b1f28a8ff248934e1466dafd59a/crates/core/airlock/src/rules.rs
[guide]: https://github.com/LayerZero-Labs/zero-evm-zone/blob/67d78af856202b1f28a8ff248934e1466dafd59a/docs/airlock.md
[lock]: https://github.com/LayerZero-Labs/zero-evm-zone/blob/67d78af856202b1f28a8ff248934e1466dafd59a/Cargo.lock
[genesis]: https://github.com/LayerZero-Labs/zero-evm-zone/blob/67d78af856202b1f28a8ff248934e1466dafd59a/deploy/evm.json#L99-L103
