# @layerzerolabs/zone-composer-evm-sdk

TypeScript SDK for the `ZoneComposer` and `ZoneComposerNative` contracts in `@layerzerolabs/zone-composer-evm-contracts`.

It exports:

- The generated ABIs and artifact getters of both composers.
- `encodeZoneComposePayload`, which forms the compose message of an OFT send into a zone composer.
- `ZONE_IDS`, the Zero zone IDs by name, for example `ZONE_IDS.SYSTEM` (`33001`) and `ZONE_IDS.SYSTEM_TESTNET` (`43001`).

## Compose payload

```ts
import { encodeZoneComposePayload, ZONE_IDS } from '@layerzerolabs/zone-composer-evm-sdk';

const composeMsg = encodeZoneComposePayload({
    dstZone: ZONE_IDS.SYSTEM,
    recipient: '0x1111111111111111111111111111111111111111',
    memo: '0xee',
});
```

The result is the ABI encoding that `ZoneComposerMsgCodec.decode` accepts. Both composers use the same payload:

- No memo, or an empty memo (`0x`): `abi.encode(uint64 dstZone, bytes recipient)`.
- A memo of 1 or more bytes: `abi.encode(uint64 dstZone, bytes recipient, bytes memo)`.

`recipient` is the account encoding of the destination zone. `memo` is opaque bytes. The encoder does not pad, trim, or change either one.

### Where the payload goes

Put the result in `SendParam.composeMsg` of the OFT send. The rest of the `SendParam` is the sender's: `to`, the amounts, and the executor options. The send also needs a compose executor option with the compose gas and a value of zero, because `lzCompose` rejects a nonzero value. This SDK does not build the `SendParam` or the options.

`SendParam.to` must be the composer bound to that exact OFT: `ZoneComposerNative` for the native ZRO OFT, and that token's `ZoneComposer` otherwise. A composer accepts compose messages only from its own OFT. When an ERC20 OFT sends to another composer, the OFT credits the tokens to that composer, and every `lzCompose` reverts with `OnlyOFT` before the composer writes a rescue record. Neither composer has a balance sweep, so the tokens are stuck. On the native ZRO path, a composer bound to another OFT refuses the native credit: `ZoneComposerNative` reverts with `OnlyOFT` in `receive`, and `ZoneComposer` has no `receive`.

### Guards

The encoder checks its input in this order, and throws a `ZoneComposePayloadError` for the first rule that the input breaks. It returns no bytes in that case.

| `detail.reason`             | When                                                                           | Other fields of `detail`     |
| --------------------------- | ------------------------------------------------------------------------------ | ---------------------------- |
| `INVALID_HEX`               | `recipient` or `memo` is not `0x` followed by an even number of hex digits     | `field`                      |
| `UNKNOWN_ZONE`              | `dstZone` has no entry in `ZONE_RECIPIENT_LENGTHS`                             | `zone`                       |
| `RECIPIENT_LENGTH_MISMATCH` | the recipient length differs from the zone's entry in `ZONE_RECIPIENT_LENGTHS` | `zone`, `expected`, `actual` |
| `ZERO_RECIPIENT`            | every byte of the recipient is zero                                            | `zone`                       |
| `MEMO_TOO_LONG`             | the memo is more than 255 bytes                                                | `maxLength`, `actual`        |

`detail` is a union on `reason`, so a caller can switch on `error.detail.reason` without parsing the message.

### Zero recipient

The encoder rejects a recipient whose bytes are all zero, after the length check, because the destination receivers lose the transfer for good:

- Native ZRO: `Airlock.receiveZro` credits a 20-byte recipient and does not reject the zero address, so the ZRO goes to address zero.
- ERC20: `ZoneRouter` credits the recipient through its token. A token that rejects address zero, as OpenZeppelin's ERC20 does, makes the credit revert. The router then caches the message, and every `retryMessage` reverts the same way. `rescueMessage` refuses a message with a 20-byte recipient, so the router owner cannot redirect it. A token that accepts address zero sends the tokens there.

### Zone recipient lengths

`ZONE_RECIPIENT_LENGTHS` maps each zone ID that the SDK accepts to the recipient length in bytes of that zone. The map is frozen, so it cannot be changed at runtime. A zone that is not in the map throws `UNKNOWN_ZONE`, and a recipient of another length throws `RECIPIENT_LENGTH_MISMATCH`. This stops a payload that the codec rejects (owner-only rescue), a payload to a zone that the SDK does not list, and a recipient that the destination zone cannot credit (for example a recipient that is not 20 bytes on Zero EVM). It does not check that the zone is routable: the composer holds a payload for retry or rescue when its deployment cannot route the zone, and that depends on deployment state, not on this map.

A zone ID is the zone's EVM chain ID. A testnet ID is the mainnet ID plus 10,000. `ZONE_IDS` names each ID, for example `ZONE_IDS.ATLAS_TESTNET` for `43003`. A name in `ZONE_IDS` does not mean that the encoder accepts the zone. The map holds these zones:

| Zone        | Mainnet ID | Testnet ID | Recipient length |
| ----------- | ---------- | ---------- | ---------------- |
| System Zone | `33001`    | `43001`    | 20 bytes         |
| ATLAS       | `33003`    | `43003`    | 20 bytes         |

The System Zone takes EVM EOA addresses, so its recipient is 20 bytes. ZRO staking sends to it.

ATLAS credits a 20-byte recipient as given. Its bridge maps a recipient of any length other than 20 or 32 bytes to the zero address, and the funds are lost. A deposit to an address with no account opens an account there. See the bridge ADR, `adrs/protocol/framework.bridge.md` in `LayerZero-Research/dragon`. A credit also needs ATLAS to map the source zone and app of the transfer to an asset. That is deployment state, not part of this map.

These zones are not in the map:

| Zone     | Mainnet ID | Testnet ID | Why not                                                                                                              |
| -------- | ---------- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| Beacon   | `33000`    | `43000`    | It is the beacon chain, not a zone that receives transfers.                                                          |
| Interop  | `33002`    | `43002`    | The composers run on this zone. To credit a recipient here, send the OFT to the recipient without a compose message. |
| Payments | `33004`    | `43004`    | Its account encoding is not settled.                                                                                 |

Add a zone when its recipient length is settled. Each zone ID is an integer in `[1, 2^53 - 1]` (`Number.MAX_SAFE_INTEGER`, the beacon's `MAX_ZONE_ID`), so that it is exact as a JavaScript number, and each length an integer in `[1, 255]`, so that every accepted input passes the codec's zone and recipient checks.
