# @layerzerolabs/sui-grpc-compat

Mysten 1.45 JSON-RPC transport shell backed by Mysten v2 gRPC + GraphQL clients.

`@mysten/sui@1.45` comes from the default catalog (`SuiTransport` / `JsonRpcError`).
`@mysten/sui@2.26` is pinned in `catalog:grpc-compat` and installed as `@mysten/sui-v2`
so this package can import both majors without moving the rest of the repo off 1.45.

Don't add private workspace dependencies (e.g. `@layerzerolabs/common-utils`) so the package
stays installable outside this repo. The exception is `@layerzerolabs/common-suimove`, which owns
LayerZero Sui protocol data such as `LZ_EVENT_BYTE_VECTOR_FIELDS`: import it only through its
dependency-free subpaths (e.g. `@layerzerolabs/common-suimove/events`), never the package root,
and keep both packages on the same externalization targets.

The root entry must also stay free of Node-only code (`@grpc/grpc-js`, `Buffer`, `node:*`) so
browser bundles can use it — bundlers resolve every import, so one stray import breaks them.
Node-only code goes behind `@layerzerolabs/sui-grpc-compat/node` (`src/node.ts`), which today
exports `createNativeGrpcTransport`.

## How it's served

`@offchain-monorepo/multiprovider`'s `SuiMoveMultiProvider` serves every Sui call on
mainnet, sandbox and testnet through this package's `SuiCompatTransport`. Whether the
transport is used is decided purely by chain identity (`resolveSuiGrpcNetwork`:
Sui on mainnet/sandbox/testnet), not by configuration. iotal1 and Sui on localnet
keep using the legacy JSON-RPC client — iotal1 has no Mysten gRPC client at all.

## Known gaps

- `getAllCoins` lists coin objects only. Address balances are supported by `getCoins`, which
  transfer's coin selection uses, through the reservation compatibility described below.
- `getObject`/`multiGetObjects`/`getOwnedObjects` throw on `showBcs`/`showDisplay` —
  unimplemented, no caller in this repo requests either today.
- A package's `content.disassembled` is always returned as `{}` — this shim never decodes Move
  bytecode, so a real caller reading a package's disassembly would silently get nothing back.

## Address balance compatibility

`getCoins` includes address balances as legacy coin reservations so v1 PTB builders can spend
them. It places the reservation on the first page so bounded coin selection can reach the
address funds even in wallets with many coin objects. Page sizes and continuation cursors still
cover every real coin exactly once; ordering is not identical to JSON-RPC. `getObject` and
`multiGetObjects` unmask missing reservation IDs using the chain's genesis digest, read the
underlying balance accumulators, and reconstruct reservations for the current epoch. This works
across provider clients without caching synthetic objects or calling JSON-RPC. The builder must
resolve these references before serializing the PTB for a wallet.

The reference format follows Sui's
[coin reservation protocol](https://github.com/MystenLabs/sui/blob/main/crates/sui-types/src/coin_reservation.rs).
The method-level `coinReservations.test.ts` exercises pagination, object resolution, and a real
v1 PTB builder using a captured address-only WBTC case. The fixture also retains the legacy
`getCoins` response. `helpers/coinReservations.test.ts` covers helper validation and RPC behavior.
Coin-type formatting retains the adapter's existing convention; matching legacy's shortened
non-system TypeTags consistently across all balance/coin methods remains a separate change.

The first `getCoins` page adds a metadata read and an accumulator read, issued concurrently.
A missing single object adds the same two reads sequentially; missing IDs in `multiGetObjects`
share one metadata read and one batch read. These reads can still fail, so reservation lookup
propagates transport failures rather than reporting an empty balance or `notExists`.
Availability depends on the gRPC provider pool; there is no JSON-RPC fallback.

`devInspectTransactionBlock` preserves executed output types from gRPC's `commandOutputs`
through the SDK's `protoJson` response. Reservation withdrawal/cleanup commands can change the
result count, so submitted-command positions cannot determine their types. The OFT PTB decoder
uses those types to select its `vector<...::move_call::MoveCall>` result. If an optional type name
is absent, the adapter retains its bytes with an empty type tag for byte-only callers; the OFT
decoder still needs a typed result.

## `SuiCompatClientOptions`

- `graphqlUrl` — optional. No method handler queries GraphQL today, so the GraphQL client is
  only constructed when a URL is supplied.
- `headers` — forwarded verbatim to the gRPC channel as `GrpcWebFetchTransport` metadata,
  the same pass-through every other VM's provider does with its `providers-v2.json` headers.
- `timeout` — client-side `AbortSignal.timeout(ms)`, merged with any caller-supplied signal.
  The multiprovider sets it to its `rpcTimeout` plus a 200ms margin.
- `grpcTransport` — replaces the default grpc-web transport. Pass
  `createNativeGrpcTransport(options)` from `/node` for gateways that reject grpc-web (the
  multiprovider does this for Alchemy and QuikNode, via `common-sui`'s `nativeGrpc` flag).
