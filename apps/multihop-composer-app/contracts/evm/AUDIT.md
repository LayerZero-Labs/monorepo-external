# MultiHopComposer — Audit Scope

## Diff from the Audited Version

The audited version is [audit-external@e3f40ad8](https://github.com/LayerZero-Labs/audit-external/commit/e3f40ad8ade14f2bd60d6a702bfff760489f0fe7), described in [`AUDIT_e3f40ad8.md`](AUDIT_e3f40ad8.md); everything there still holds unless stated otherwise. Two files are new and the base changed in one place:

1. **`MultiHopComposerNative`** composes native OFTs (`token() == address(0)`). It inherits `MultiHopComposer` unchanged, overrides `_processOFTs` (native only, no approvals), `_send` (pays the amount as value on top of the fee) and `rescue` (one native transfer), and adds `receive`.
2. **`IMultiHopComposerNative`** adds `NativeRequired`, thrown for an OFT whose token is not native.
3. **The constructor emits `NativeRefundRecipientSet` and `MaxEnforcedMsgValueSet`.** The constructor and both setters write through `_setNativeRefundRecipient` and `_setMaxEnforcedMsgValue`, so a deployment's log holds the initial configuration in the same events as a later update.

---

## Files in Scope

| File                                     | Description         |
| ---------------------------------------- | ------------------- |
| `MultiHopComposer.sol`                   | The base composer   |
| `MultiHopComposerNative.sol`             | The native composer |
| `interfaces/IMultiHopComposerNative.sol` | Its interface       |

---

## Security-Relevant Mechanisms

- **Native accounting.** Each path pays `msg.value + cachedValue + amountLD`, with `amountLD` from the compose header and a `nativeFee` that excludes it, so it spends only its own hop's share and other hops' native stays out of reach. A credit whose compose is pending or reverted is recovered by delivering it again; native that arrives with no compose, including forced native, is not.
- **`retry`, `refund` and `rescue` delete the record before any external call.** A reentrant call from the endpoint's fee refund, `_to`, or an OFT's fee recipient can only act on another record.
- **`receive` accepts native only from registered OFTs.** A credit through an unregistered OFT reverts its `lzReceive`, or, if redirected to an escrow, its zero-amount compose reverts `OnlyOFT`; no native reaches the composer.
- **`msg.value` must match exactly.** A native OFT's `send` requires `msg.value == nativeFee + amount`. When the inbound OFT has more shared decimals, the amount has dust for the outbound OFT. An OFT that requires the amount without dust, such as [`NativeOFTAdapter`](https://github.com/LayerZero-Labs/devtools/blob/0306f189c59aa562e3334e35ced8a66ba003f0de/packages/oft-evm/contracts/NativeOFTAdapter.sol#L65-L78), fails the send, so the hop can only be refunded. One that takes the full amount, such as the [Console OFT](https://github.com/LayerZero-Labs/audit-external/blob/e3f40ad8ade14f2bd60d6a702bfff760489f0fe7/apps/oft-app/contracts/evm/upgradeable/contracts/extended/OFTNativeExtendedRBACUpgradeable.sol#L73-L116), pays the dust to its fee recipient. No dust stays in the composer.
- **`nativeRefundRecipient` must accept native and must not be the composer.** `setNativeRefundRecipient` rejects only `address(0)`, and `receive` would reject the endpoint's fee refund, reverting every send and refund that returns unused fee.
- **`rescue` duplicates the base guards** and event. It always transfers native, so a `_to` that rejects native always fails it; the base fails only when `msgValue` is not zero.
- **Base statements that no longer apply.** No allowance or `SafeERC20` call remains, as the overridden `_processOFTs` and `rescue` were the only base code using `IERC20(TOKEN)`. Native credits are exact, so the fee-on-transfer assumption does not apply, and no dust stays in the composer.
