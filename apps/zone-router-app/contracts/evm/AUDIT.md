# Zone router — Audit Scope

## Files in Scope

- [`ZoneRouter.sol`](contracts/ZoneRouter.sol): settlement, peer configuration and cached delivery.
- [`ZoneRouterFactory.sol`](contracts/ZoneRouterFactory.sol): atomic CREATE2 proxy deployment and registry.
- [`IZoneRouter.sol`](contracts/interfaces/IZoneRouter.sol) and [`IZoneRouterFactory.sol`](contracts/interfaces/IZoneRouterFactory.sol): public interfaces.
- [`IAirlock.sol`](contracts/interfaces/IAirlock.sol) and [`IAirlockReceiver.sol`](contracts/interfaces/IAirlockReceiver.sol): shared Airlock definitions/address and relayer entry point.

## Expected Usage and Trust

The chain installs both the canonical `ZoneRouter` EVM implementation and `ZoneRouterFactory` as predeploys. Per-token ERC1967 proxies delegate to that implementation and hold independent ERC-7201 state. The chain controls implementation updates; neither proxy owners nor the factory expose an implementation-upgrade function. Proxy owners control peers, caching markers and malformed-recipient rescue through two-step ownership. Token and settlement configuration is fixed and ownership cannot be renounced. See [router](contracts/ZoneRouter.sol) and [factory](contracts/ZoneRouterFactory.sol).

Peers must represent the same asset. The token, its privileged operators and the optional backend are trusted to settle exact amounts or revert. Fee-on-transfer and rebasing tokens are unsupported. Backend selectors, permissions and return behavior are integration responsibilities; successful return data is ignored. See [settlement](contracts/ZoneRouter.sol).

Airlock must authenticate application identity, proof, channel and consecutive nonces, journal cursor changes before token calls, and roll them back with the EVM frame. These host guarantees are not implemented by the router. The consumed ABI is [local](contracts/interfaces/IAirlock.sol); the integration reference is [the pinned upstream interface](https://github.com/LayerZero-Labs/zero-evm-zone/blob/67d78af856202b1f28a8ff248934e1466dafd59a/crates/core/airlock/sol/IAirlock.sol).

The [expected Airlock behaviour](docs/expected-airlock-behaviour.md) separates inspected host enforcement, delegated protocol obligations and integration limits.

## Security-Relevant Mechanisms

- **Backed sends.** Token debit and Airlock send are atomic. Lock/unlock uses shared router liquidity; burn/mint burns from the caller, and burn-self/mint pulls then burns. Configuration validation checks token code, a nonzero backend for burn modes and local decimals at most 18 and equal to the token's `decimals()`; it does not prove backend behavior. See [`initialize`, `_debit` and `_credit`](contracts/ZoneRouter.sol).
- **Precision and recipients.** `Airlock` amounts use 18 decimals. Sends debit the full local amount, reject zero and scale up; overflow reverts the send. Receives scale down, drop any remainder below one local unit, and require exactly twenty recipient bytes. Token rejection fails isolated settlement. The token decides whether zero amounts and zero addresses are valid. See [`sendToken` and `receiveMessage`](contracts/ZoneRouter.sol).
- **Peer authority.** Default peers authorize sends and receives; extra peers authorize receives, including new transfers. Removing all inbound trust blocks new delivery but not exact cached retries. Owner misconfiguration can break backing. Default-peer value writes always emit; unchanged extra-peer membership requests revert. See [peer setters](contracts/ZoneRouter.sol).
- **Cached claims.** Claim hashes are keyed by authenticated source zone, exact application and nonce; counts are per source channel. Retry consumes the matching full-message hash and decrements its count before settlement. Reverts restore both; deletion prevents retry replay. Initial replay prevention relies on Airlock. Each hashed message includes its own nonce, which Airlock authenticates, so no two claims on a channel hash the same. See [cache and retry](contracts/ZoneRouter.sol).
- **Gas and ordering.** Isolated calls use no custom gas reserve and copy no return data. Insufficient gas to cache a failure reverts the batch and cursor. Owner-marked nonces are permanent, reject repeated marking, and are cached on authenticated delivery for permissionless retry. Cached claims can settle out of order and reserve no liquidity. See [batch handling](contracts/ZoneRouter.sol).
- **Limited rescue.** Only the owner can redirect an exact cached claim whose original recipient is not twenty bytes, to a nonzero local address. Retry and rescue share claim consumption and rollback. Valid-length recipients cannot be redirected, even when token settlement rejects them. There is no general discard, replacement or refund path. See [`rescueMessage`](contracts/ZoneRouter.sol).
- **Deployment.** Factory deployment has no caller role check and is subject to external chain deployment policy. Proxy creation and initialization are atomic. CREATE2 uses the supplied salt and complete init code. The non-enumerable registry records only addresses deployed by this factory; it does not authenticate token backing or remote peers. See [the factory](contracts/ZoneRouterFactory.sol).
