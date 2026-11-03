# `@layerzerolabs/protocol-v1-0.7-evm-contracts`

LayerZero V1 EVM contracts on Solidity 0.7.6, whose interfaces the V2 message libraries import.

Copied byte for byte from `@layerzerolabs/lz-evm-v1-0.7` (`packages/layerzero-v1/evm/0.7`) in the old LayerZero-Labs/monorepo at `origin/cb/executor-upgrade` (`d976cafeaf`). Only `contracts/` and the Foundry tests are copied; the old deploy scripts, deployment records, typechain bindings and Hardhat tests are not.

## Build

`pnpm build` compiles with the old compiler settings (`hardhat.config.cjs`) into `artifacts/` (EVM) and `artifacts-tron/` (Tron), which the package publishes for consumers to read by path, e.g. `@layerzerolabs/protocol-v1-0.7-evm-contracts/artifacts/contracts/<Source>.sol/<Contract>.json`.

`pnpm test:snapshot:check` checks the compiled bytecode against `turbo-snapshot.lock.json`.

## Test

`pnpm test` runs the Foundry tests.
