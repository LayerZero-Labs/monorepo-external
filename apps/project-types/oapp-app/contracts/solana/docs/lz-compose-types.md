# Compose planning (LzComposeTypes V3)

Compose uses the same simulation-only [planning protocol](lz-receive-types.md) as receive: a
caller-created scratch account, a `u32` plan length in return data, and the same plan encoding.

Differences from receive:

| Concern               | Compose                                                     |
| --------------------- | ----------------------------------------------------------- |
| Identity              | `params.to`, the composer account                           |
| Discovery PDA         | `[b"LzComposeTypes", params.to]` under the composer program |
| Bootstrap instruction | `lz_compose_types_info(params)`                             |
| Planner instruction   | `lz_compose_types_v3(params)`                               |
| Payload               | `LzComposeTypesV3Result { context_version, instructions }`  |
| Primary variant       | `ComposeInstruction::LzCompose { accounts }` (tag 0)        |
| Delivery instruction  | `lz_compose(params)`                                        |

Bootstrap return data is Borsh `(3u8, LzComposeTypesV3Accounts)`; the planner's accounts are the
payer and scratch followed by those inputs, as for receive. The receive
[planner obligations](./lz-receive-types.md#planner-obligations) apply to `lz_compose` with the
Endpoint `clear_compose` accounts in place of `clear`. Anyone can queue a compose message with the
Endpoint's `send_compose`, and its signer becomes `from`; `clear_compose` only proves the message
came from `params.from`. So `lz_compose` must require `params.from` to be an OApp it trusts, such
as a stored OFT store key, as `lz_receive` checks its peer. The `Standard` instruction variant and
all address locators encode as for receive.

Clients reject a plan without exactly one `LzCompose`. Include the Endpoint `clear_compose`
accounts using `oapp::lz_compose_types_v3::get_accounts_for_clear_compose`. Bind all composer
identity references to `params.to`; the `lz_compose` handler must itself authenticate and clear the
live compose message.

The `#[composer]` macro requires `lz_compose_types_info`, `lz_compose_types_v3` and `lz_compose`
overrides. The planner takes a mutable context and returns the plan length from
`oapp::lz_plan::write`.
