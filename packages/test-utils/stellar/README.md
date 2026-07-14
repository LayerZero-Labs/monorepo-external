# @layerzerolabs/test-utils-stellar

Shared Stellar E2E harness for localnet lifecycle, protocol deploy/wire, and test helpers.

## Usage

### Env (unique container/port per suite)

```ts
import { createStellarTestEnv } from '@layerzerolabs/test-utils-stellar';

export const env = createStellarTestEnv({
    containerName: 'stellar-oft-e2e',
    hostPort: 8096,
});

export const { RPC_URL, DEFAULT_DEPLOYER, EID_A, EID_B /* ... */ } = env;
```

Do **not** use `process.env` for ports — pass `hostPort` into `createStellarTestEnv`.

### Protocol stack globalSetup (OFT / omni-counter)

Pass protocol contract modules from `@layerzerolabs/lz-v2-stellar-sdk` (not local
`generated/` paths). Injection keeps this package free of a workspace cycle with
the SDK (SDK tests also consume this harness).

```ts
import path from 'path';
import { getFullyQualifiedRepoRootPath } from '@layerzerolabs/common-node-utils';
import {
    dvn,
    dvnFeeLib,
    endpoint,
    executor,
    executorFeeLib,
    executorHelper,
    priceFeed,
    sml,
    treasury,
    uln302,
} from '@layerzerolabs/lz-v2-stellar-sdk';
import { createProtocolStackGlobalSetup } from '@layerzerolabs/test-utils-stellar';
import { env } from './constants.js';

export default createProtocolStackGlobalSetup(env, {
    protocol: {
        endpoint,
        treasury,
        uln302,
        sml,
        priceFeed,
        executorFeeLib,
        dvnFeeLib,
        dvn,
        executorHelper,
        executor,
    },
    wasmDir: async () => {
        const repoRoot = await getFullyQualifiedRepoRootPath();
        return path.join(
            repoRoot,
            'contracts/protocol/stellar/contracts/target/wasm32v1-none/release',
        );
    },
});
```

Provides `chainA` / `chainB` (`ChainAddresses`) to Vitest via `inject()`.

### Localnet-only globalSetup (protocol SDK)

```ts
import { createLocalnetOnlyGlobalSetup } from '@layerzerolabs/test-utils-stellar';
import { env } from './constants.js';

export default createLocalnetOnlyGlobalSetup(env);
```

### Deploy / scan / helpers

All helpers take `env` as the first argument (or close over it in a thin consumer shim):

```ts
import {
    deployContract,
    fundAccount,
    createClient,
    scanPacketSentEvents,
} from '@layerzerolabs/test-utils-stellar';

await fundAccount(env, publicKey);
const client = createClient(env, SomeClient, contractId);
```

## Key exports

| Export                                                                | Description                                   |
| --------------------------------------------------------------------- | --------------------------------------------- |
| `createStellarTestEnv`                                                | Build RPC URL, keys, EIDs from container/port |
| `createProtocolStackGlobalSetup`                                      | Dual-chain deploy + wire Vitest globalSetup   |
| `createLocalnetOnlyGlobalSetup`                                       | Start/stop localnet only                      |
| `ChainAddresses`                                                      | Type for injected protocol addresses          |
| `deployContract` / `uploadWasm` / `deployAssetSac`                    | Deploy helpers                                |
| `startStellarLocalnet` / `stopStellarLocalnet` / `fundAccount`        | Localnet lifecycle                            |
| `createClient` / `signDvnAuthEntries` / `signAndSendWithExecutorAuth` | Client + auth helpers                         |
| `scanPacketSentEvents`                                                | Endpoint event scanning                       |
| `Secp256k1KeyPair`                                                    | DVN multisig signer helper                    |
