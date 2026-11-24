# Zone token routing

`ZoneRouter` is the Zero EVM zone's canonical token-routing implementation predeploy. `ZoneRouterFactory` is a separate predeploy that creates issuer-owned ERC1967 proxies. Each proxy holds one token's configuration and state, and delegates execution to `ZoneRouter`. The chain controls implementation updates; proxy owners have no implementation-upgrade function. See [the router](contracts/ZoneRouter.sol) and [factory](contracts/ZoneRouterFactory.sol).

## Configure and use a router

Call `deploy(initialOwner, config, salt)` on the factory to create and initialize a proxy atomically. The function has no caller allowlist; chain-level contract-deployment restrictions still apply. The factory has no owner. The supplied 32-byte CREATE2 salt, implementation and complete initialization arguments determine the address. `isRouter(address)` reports only proxies created by that factory. See [the factory interface](contracts/interfaces/IZoneRouterFactory.sol).

Choose the token, its local decimals and one settlement mode at initialization. These settings cannot change:

- `LockUnlock`: sends lock tokens in the router; receives release its liquidity.
- `BurnMint`: sends call the configured backend to burn from the caller; receives mint.
- `BurnSelfMint`: sends transfer tokens into the router, then call the backend to burn from the router; receives mint.

Burn modes require a nonzero burner/minter. Their explicit burn selectors accept `(address,uint256)` and `(uint256)`, respectively; the mint selector accepts `(address,uint256)`. Zero selectors are permitted. Lock/unlock does not use backend fields. The token and backend must settle exact amounts or revert; fee-on-transfer and rebasing tokens are unsupported. Approve the router for transfers into it, or the backend as required for direct burns. See [`Config`](contracts/interfaces/IZoneRouter.sol) and [settlement](contracts/ZoneRouter.sol).

Local decimals range from 0 through 18 and must equal `token.decimals()`: initialization reverts with `LocalDecimalsMismatch` when they differ, and reverts when `decimals()` cannot be read. The router reads `decimals()` only at initialization. `Airlock` messages carry amounts in 18 decimals. `sendToken` debits the full amount and scales it up to 18 decimals; a zero amount reverts with `ZeroAmount`. Receiving scales the 18-decimal amount down to local units and drops any remainder below one local unit. Each router converts only its own side, so peers must represent the same asset but need not share decimals. See [`sendToken` and `receiveMessage`](contracts/ZoneRouter.sol).

`setZonePeer` selects one outbound and default inbound application per remote zone. `setExtraInboundPeer` permits additional inbound applications, including new transfers, without changing outbound routing. Empty default peers disable sends but do not revoke extra inbound peers. Application identifiers retain their exact bytes. Both peer-list getters return unordered lists. Repeating `setZonePeer` still emits its event; requesting an unchanged extra inbound permission reverts. The router owner uses two-step ownership transfers and cannot renounce ownership. See [the router interface](contracts/interfaces/IZoneRouter.sol).

To transition peers, retain the old application as an extra inbound peer, switch the outbound peer, stop old-peer outbound sends, drain in-flight transfers, then revoke the old extra inbound peer. Revocation does not cancel cached claims: anyone can still retry them later. The router does not enforce this sequence or limit extra peers to old transfers. See [peer configuration and retry](contracts/ZoneRouter.sol).

## Deliver and recover transfers

Anyone can relay through `airlockReceive(srcZone, srcApp, firstNonce, count)`. Airlock authenticates the receiving application, proof and ordered channel; the router accepts only a default or extra inbound peer. Airlock supplies structured messages, not relayer-provided delivery payloads. Incoming EVM recipients must be exactly twenty bytes. The token decides whether zero recipients and zero amounts are accepted. See [the receiver interface](contracts/interfaces/IAirlockReceiver.sol) and [shared Airlock interface](contracts/interfaces/IAirlock.sol).

Each transfer settles in an isolated call. Failures and owner-marked nonces are cached by exact message hash and emit the complete message in `MessageCached`. Anyone can call `retryMessage` with that message, even after its peer changes or is revoked. `cachedMessagesCount` reports pending claims per source channel. Successful retry consumes the claim before settlement; a revert restores it. Retries can settle out of nonce order, and cached claims do not reserve liquidity. See [delivery and retry](contracts/ZoneRouter.sol).

The owner can use `rescueMessage` only for an exact cached claim whose original recipient is not twenty bytes, choosing a nonzero local recipient. Twenty-byte recipients cannot be redirected, including when the token rejects them. There is no discard or general refund function. Token pauses, rate limits and liquidity shortages can be retried after their cause is fixed. See [rescue](contracts/ZoneRouter.sol).

`markMessageForCaching` permanently marks a nonce for caching on authenticated delivery, without executing settlement. Marking alone creates no claim and does not advance Airlock's cursor. Marking an already marked nonce reverts. There is no custom settlement gas limit or reserve: insufficient gas to cache a failure reverts the batch and cursor. Supply more gas, reduce the batch, or mark the nonce before relaying again. See [batch handling](contracts/ZoneRouter.sol).

For OFT entry into Zero, use the [composer package](../../../zone-composer-app/contracts/evm/README.md). A router serves one token; each composer serves one OFT. See [`ZoneComposer`](../../../zone-composer-app/contracts/evm/contracts/ZoneComposer.sol).
