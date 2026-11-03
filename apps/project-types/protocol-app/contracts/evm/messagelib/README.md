# `@layerzerolabs/protocol-v2-messagelib-evm-contracts`

LayerZero V2 EVM message libraries (ULN 301/302, read library), DVN, executor, price feed and treasury contracts. Its sources import `@layerzerolabs/lz-evm-protocol-v2` and `@layerzerolabs/lz-evm-v1-0.7`, which resolve to the workspace copies through package aliases, so the source names, and with them the metadata hashes, stay as published.

Copied byte for byte from `@layerzerolabs/lz-evm-messagelib-v2` (`packages/layerzero-v2/evm/messagelib`) in the old LayerZero-Labs/monorepo at `origin/cb/executor-upgrade` (`d976cafeaf`). Only `contracts/` and the Foundry tests are copied; the old deploy scripts, deployment records, typechain bindings and Hardhat tests are not.

## Build

`pnpm build` compiles with the old compiler settings (`hardhat.config.cjs`) into `artifacts/` (EVM), `artifacts-zk/` (zkSync) and `artifacts-tron/` (Tron), which the package publishes for consumers to read by path, e.g. `@layerzerolabs/protocol-v2-messagelib-evm-contracts/artifacts/contracts/<Source>.sol/<Contract>.json`.

`pnpm test:snapshot:check` checks the compiled bytecode against `turbo-snapshot.lock.json`.

## Test

`pnpm test` runs the Foundry tests.
