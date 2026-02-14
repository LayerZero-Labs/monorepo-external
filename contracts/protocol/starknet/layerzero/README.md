# LayerZero V2 - Starknet Implementation

## Background & Motivation

The LayerZero V2-Starknet implementation maintains the same core architecture and functionality as LayerZero V2-EVM while adapting to Starknet's unique features and constraints. The protocol preserves LayerZero's core values of permissionlessness, immutability and censorship-resistance.

Starknet supports dynamic inter-contract calls via dispatcher interfaces, allowing LayerZero V2 to maintain its modular, runtime-configurable architecture. By using Dynamic Dispatchers we can allow pluggable message libs, independent workers and minimal protocol surface without needing complex workarounds or fundamental architectural changes.

The Starknet LayerZero implementation is architecturally very close to the EVM implementation, maintaining the same three-step messaging flow:

1. **Send**: OApp calls EndpointV2 with message parameters
2. **Verify**: DVNs verify messages and submit their validation to the message lib
3. **Commit**: Via a permissionless call, the message library asserts commitment requirements and commits payload hash to the endpoint
4. **Execute**: Via a permissionless call, the EndpointV2 delivers verified message to receiver

## Starknet Specific Changes

### Starknet Components vs EVM Abstract Contracts

Unlike EVM abstract contracts that function as inheritance-based blueprints allowing multiple implementations and complex inheritance hierarchies, Starknet components operate as modular add-ons that are directly embedded into a contract's bytecode at compile-time. While EVM abstract contracts can be inherited multiple times and combined in various ways, Starknet enforces a strict "one instance per component type per contract" limitation—meaning you cannot embed the same component multiple times within a single contract. Also note that the external interface of a component can be directly exposed on the contract integrating it by using the `#[abi(embed_v0)]` macro.

### Contract Upgrades

Starknet provides native upgradeability through the `replace_class_syscall` mechanism, where contract addresses remain stable while the underlying class implementation can be swapped via `replace_class`. Unlike Ethereum's proxy pattern that requires complex delegation logic, Starknet's approach directly updates the class hash associated with a contract instance. While our EndpointV2 and UltraLightNode302 contracts are intentionally immutable for security and stability, we've implemented upgradability in worker contracts (Pricefeed, DVN, and Executor). However, the upgrade mechanism in Starknet comes with critical storage layout constraints: since Starknet calculates storage slot locations by hashing variable names, renaming existing storage variables will cause them to map to entirely different storage slots, potentially leading to data loss or corruption. Additionally, reordering storage variables can disrupt the expected memory layout. To maintain upgrade safety, existing storage variables must never be renamed or reordered—new variables should only be appended to the storage structure, and deprecated variables should be left in place (though unused) to preserve the storage layout integrity across upgrades. This is why we have prefixes for the names of storage items of our upgradable components. (You can see an example of this at: `layerzero/src/workers/base/base.cairo`)

### Type/Serialization Compatibility

Cairo's type system is built on 252-bit field elements (felt252) as the fundamental storage unit, with all data types ultimately serialized to sequences of felt252 values. For cross-chain interoperability, we strategically maintain u256 types, which Cairo represents as structs containing two felt252 elements: the lower 128 bits in the first element and the upper 128 bits in the second. We utilize the ByteArray struct from the Alexandria Bytes package instead of `Array<felt252>` for string and byte sequence handling because ByteArray provides structured encoding with 31-byte chunks (bytes31) packed into felt252 elements, plus a pending word for remaining bytes and length metadata. This ensures matching serialization/deserialization that maintains data integrity across different blockchain environments, whereas raw `Array<felt252>` lacks the structured byte boundaries necessary for reliable cross-chain string encoding.

### Fee Handling

Starknet has no native value (equivalent of msg.value on Ethereum) attached to transactions, so we implement an allowance-based system using ERC20 tokens (STRK) for worker payments. The EndpointV2 validates allowances before processing and automatically refunds excess amounts to prevent misplacement of user funds.

## Motivation for LayerZero-Starknet Architecture

### Native Dynamic Dispatch

Starknet's built-in dispatcher system enables the protocol to call libraries and receivers directly by address through typed dispatchers, eliminating the need for complex proxy patterns or unsafe low-level calls. Starknet also enables developers to use SafeDispatchers to gracefully handle the possible errors thrown on inter-contracts calls.

### Component-Based Modularity

Components are the Starknet equivalent of adding abstract contracts, they have a modular approach where you can add the components you need, expose their entry points, and they can have their own storage variables.

The MessageLibManager Component maintains per-path send/receive library selections, enabling upgrades and library diversification without changing the EndpointV2 or OApps. This provides clean separation of concerns:

- **MessagingChannelComponent**: Manages nonces and payload tracking, provides skip-burn-nillify functionality
- **MessageLibManagerComponent**: Handles message library selection and configuration
- **MessagingComposerComponent**: Supports multi-step message composition (lzCompose)
- **OwnableComponent**: Provides access control (from OpenZeppelin)
- **ReentrancyGuardComponent**: Prevents reentrancy attacks (from OpenZeppelin)

### Worker Integration

DVNs and Executors integrate through standard interfaces and fee libraries, driving quoting and payment logic at the message library/worker layers, maintaining the same flexibility as the EVM implementation.

### Compose Support

Multi-step application flows (e.g., OFT compose) are supported through optional, standardized interfaces via the EndpointV2, providing the same composability features as other LayerZero implementations while leveraging Starknet's type safety.

## Architecture Overview

### High-Level Architecture

The Starknet implementation of LayerZero V2 enables crosschain messaging with the core values of immutability, censorship resistance, and permissionless access. It allows configurable messaging with changeable message libraries and customized security with Decentralized Verifier Networks (DVNs), and facilitates crosschain execution of messages with permissionless Executors.

### Central Hub — EndpointV2

**Files**: `src/endpoint/endpoint.cairo`, `src/endpoint/interfaces/endpoint.cairo`

**Responsibilities**: The EndpointV2 acts as the central router for messages, handling nonces, managing fees, emitting events, and coordinating delivery across various stages (send, quote, commit, lz_receive, send_compose).

**Components**:

- **message_lib_manager**: Responsible for selecting the appropriate send and receive libraries for each communication path.
- **messaging_channel**: Manages nonces and EndpointV2 IDs (EIDs).
- **composer**: Facilitates the composition of multi-step messages.

**Token Management**: The EndpointV2 also manages the LayerZero (LZ) token address, which enables users to pay the treasury fee in the LZ-token. This feature is currently implemented but disabled.

### Message Libraries

Message Libraries are crucial for defining the security characteristics of cross-chain communication.

#### ULN (Production): `src/message_lib/uln/ultra_light_node_302.cairo`

- Handles quoting, sending, verification by DVNs, and committing messages based on defined thresholds and confirmations.
- Manages per-path configurations, including required/optional DVNs, thresholds, confirmations, executor assignments, and parsing the worker options passed by the OApp.
- It also protects the amount of payment the Treasury can receive per message, making it impossible for the treasury contract to censor through high fees, and it doesn't allow the owner of the message lib contract to change Treasury to prevent future change of treasury that could gas bomb censor messages

#### SML (Testing): `src/message_lib/sml/simple_message_lib.cairo`

- A minimal security library primarily used for testing purposes, which emits PacketSent events.

### Treasury

The protocol's treasury is designed to receive payments for user messages and must remain immutable to prevent censorship through "gas bombing" on the native payment path. This design ensures future payment compatibility with LZ tokens and allows for a configurable ZRO (LZ-token) token fee address.

### Workers

Workers are an abstract entity that have an on-chain send/receive part, and an off-chain part which handles the connection between the source and destination blockchains. Here we lay out the details of their on-chain contracts.

#### DVN: `src/workers/dvn/`

- Offchain listeners of DVNs monitor source chains for outbound messages.
- On the receive side, each DVN independently verifies the message actually exists and adds current confirmations by calling `ULN.verify()`.
- ULN stores verification in a Verification struct: `{submitted: bool, confirmations: u64}`.
- **Fee Library**: On the send side, the DVN makes a cost calculation based on gas prices and configuration to charge the user for the delivery of the message.

#### Executor: `src/workers/executor/`

- Delivers messages by calling `endpoint.lz_receive()`, manages ERC20 (=native) value, and handles retry mechanisms and alerts.
- Apply native drop in the source chain (mechanism where you pay extra in source chain native to receive on destination chain native)

#### Price Feed: `src/workers/price_feed/`

- Provides gas and price quotes for fee calculations.

#### Treasury: `src/treasury/`

- Quotes fees for the protocol. Also allows future payment in lz token by calling a configurable contract address called the lzTokenFeeLibrary

### OApps (Application Layer)

OApps represent the application layer built on top of LayerZero V2.

#### OApp Core: `src/oapps/oapp/oapp_core.cairo`

- Provides integration with the EndpointV2, manages peer mappings, defines standardized lz_receive hooks, and handles access control.

#### OFTs (Omnichain Fungible Tokens): `src/oapps/oft/`

- Supports native mint/burn model (`oft.cairo`) or adapter-based lock/unlock model (`oft_adapter.cairo`), including shared-decimal handling in `oft_core.cairo`.

#### Options Type 3: `src/oapps/common/oapp_options_type_3/`

- Defines execution options and compose functionality.

### Common Primitives

- `src/common/`: Contains fundamental components such as packet encoding/decoding (`packet_v1_codec.cairo`), generating Global Unique Identifiers (GUIDs), type conversions, constants, and core data structures (`packet.cairo`, `messaging.cairo`).

### Utils `libs/`

- `libs/`: Contains Multisig, Error, Big endian keccak related logic that is reused in Onesig Starknet and Layerzero endpoint (identical code between OneSig-Starknet and LayerZero V2-Starknet, will soon be moved to a common package)

## End-to-End Flow (High Level)

### Send Flow (Source Chain)

1. User -> OApp quote for worker native fees
2. User -> Native Token / LZ token ERC20 approve amount quoted to OApp
3. User -> OApp -> EndpointV2 -> Message lib -> Workers
4. User calls send.
5. OApp receives token and gives allowance to EndpointV2 calls send
6. The EndpointV2 forwards it to a Message Library (e.g., ULN).
7. The Message Library quotes and emits a `DvnFeesPaid`, `ExecutorFeePaid`, `TreasuryFeePaid` events
8. The EndpointV2 pays the workers based on receipts returned by the ULN and emits `PacketSent` which is observed and acted upon offchain

### Receive Flow (Destination Chain)

1. DVN -> ULN, verify independently the message.
2. ULN -> EndpointV2 , commit Executor permissionless calls commit on ULN
3. Executor -> EndpointV2 -> OApp, execute calls lz_receive
4. The OApp processes the received message.

### Compose flow (Optional)

1. During lz_receive, the OApp may enqueue a compose via `MessagingComposer.send_compose(to, guid, index, message)`.
2. Later, the Executor calls `MessagingComposer.lz_compose(from, to, guid, index, message, extra_data, value)`.
3. Composer verifies the message hash, marks it received, optionally transfers compose-token value, and calls target `ILayerZeroComposer.lz_compose(...)`.
4. Target contract executes compose logic; `ComposeDelivered` or `LzComposeAlert` is emitted.
5. The compose flow is complete after the target contract executes its logic and an event is emitted.

### Native Drop (Executor)

- User adds native drop options and pays extra on source chain
- Executor on destination chain pays in native to specified addresses

### Skip (OApp)

- **Purpose**: Increment inbound nonce without execution (recover from stuck messages)
- **Process**: `MessagingChannel.skip()` → updates `lazy_inbound_nonce` → emits `InboundNonceSkipped`
- **Use**: Stuck messages, unwanted messages, nonce gaps
- **Security**: Must be sequential, authorized only

### Burn (OApp)

- **Purpose**: Mark verified message as unexecutable
- **Process**: Sets payload hash to `NIL_PAYLOAD_HASH` → prevents execution but preserves verification
- **Use**: Vulnerable payloads, incident response, malicious messages
- **Security**: Requires current payload hash, cannot nillify executed messages, authorized only

### Nilify (OApp)

- **Purpose**: Permanently destroy message (irreversible)
- **Process**: Sets payload hash to `EMPTY_PAYLOAD_HASH` → never re-verifiable/executable
- **Use**: Malicious messages, compromised scenarios, storage cleanup
- **Security**: Irreversible, requires current payload hash, authorized only

## Payments

### Quote and Pay

Message Libraries return the payees for workers. The EndpointV2 pulls fees from the OApp's allowance and pays the workers, refunding any excess.

### Native vs. LZ Token

The native token payment path is fully functional, while the LZ token path requires a contract for LZ token fee payment logic which is set on Treasury

## Data Model

- **Packet**: Contains essential information about a message, including nonce, source/destination EIDs, sender/receiver addresses, GUID, and payload.
- **MessagingParams**: Defines parameters for message sending, such as destination EID, receiver, message content, options, and a flag for LZ-token payments.
- **Origin**: Specifies the source EID, sender address, and nonce for a message.

## Extensibility and Configuration

- **Per-Path Libraries**: The message_lib_manager dynamically selects send/receive libraries based on the peer EID and OApp address.
- **ULN Configurations**: The ULN allows for granular configuration, including DVN sets, verification thresholds, confirmation requirements, and executor assignments per receiver or source path.
- **Options**: Message options are split into executor and DVN sub-options and support message composition.

## Directory Structure

```text
├── endpoint/                   # EndpointV2 contract and components
│   ├── interfaces/             # Interfaces related to endpoint
│   ├── message_lib_manager/    # Message lib managing component
│   ├── messaging_channel/      # Messaging Channel component
│   └── messaging_composer/     # Messaging Composer component
├── message_lib/                  # Message libs
│   ├── sml/                    # Simple Message Library (testing)
│   └── uln/                    # Ultra Light Node (production)
├── oapps/                      # Omnichain application framework
│   ├── counter/                # Example counter app
│   ├── oapp/                   # Base omnichain applications
│   └── oft/                    # Omnichain fungible tokens
├── workers/                    # Off-chain infrastructure contracts
│   ├── base/                   # Base worker components
│   ├── dvn/                    # Data verification networks
│   ├── executor/               # Message execution & delivery
│   └── price_feed/             # Gas price estimation
├── treasury/                   # Fee collection & worker payments
└── common/                     # Shared utilities & data structures
```
