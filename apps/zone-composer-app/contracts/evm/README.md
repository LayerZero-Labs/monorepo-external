# Zone composers

Zone composers extend an OFT transfer into another Zero zone. `ZoneComposer` forwards credited ERC20 tokens through a token's `ZoneRouter` proxy. `ZoneComposerNative` forwards credited native ZRO directly through the `Airlock` precompile. Return transfers pay the selected local recipient; an onward OFT send is a separate action. See [the composers](contracts) and [token routing guide](../../../zone-router-app/contracts/evm/README.md).

## Configure and send

Deploy one composer for its configured OFT and initial owner. For ERC20 tokens, supply a router for the same token and configure the backend permissions required by its settlement mode. The composer grants maximum token allowance to the router, except in `BurnMint` mode with a `burnerMinter` other than the token, which receives the allowance instead. The native variant requires an OFT whose token is native and fixes `ROUTER` to Airlock. These connections cannot change. See [`ZoneComposer`](contracts/ZoneComposer.sol) and [`ZoneComposerNative`](contracts/ZoneComposerNative.sol).

Send the OFT credit to the composer with ABI payload `(uint64 dstZone, bytes recipient)` or `(uint64 dstZone, bytes recipient, bytes memo)`. An omitted memo becomes empty bytes. Use the destination zone's raw account encoding, without transport length prefixes. The destination zone must be nonzero, the recipient must contain 1–255 bytes, and the memo may contain at most 255 bytes. See [the message codec](contracts/libs/ZoneComposerMsgCodec.sol).

## Retry and recovery

An undecodable payload records its credited amount by GUID in `rescuableMessages` for owner-only `rescue` to a nonzero local recipient. Both composer variants expose this getter. See [decoding and rescue](contracts/ZoneComposer.sol).

For ERC20 credits, a missing router peer at compose delivery also creates a rescue record and emits `UnroutableZone`. The native composer does the same when the `Airlock.isActiveZone(dstZone)` query returns false. This consumes the endpoint delivery and caches the transfer hash in `retryableMessages`. Anyone can then call `retry` with the transfer from the `UnroutableZone` event. It forwards through the same router or `Airlock`, which reject a destination that is still unroutable. Until a retry succeeds, the composer owner can also `rescue` the credit to any nonzero local recipient. See [routing, retry and ownership](contracts/ZoneComposer.sol).

Other forwarding reverts leave compose queued for endpoint retry. Native query and send reverts also remain queued. Native forwarding depends on the [Airlock interface assumptions](../../../zone-router-app/contracts/evm/docs/expected-airlock-behaviour.md#airlock-interface-assumptions). Ownership transfers use two steps and cannot be renounced. Neither composer has a general balance sweep or return-to-source function. See [forwarding and rescue](contracts/ZoneComposer.sol), [native forwarding](contracts/ZoneComposerNative.sol) and [router precision](../../../zone-router-app/contracts/evm/README.md).
