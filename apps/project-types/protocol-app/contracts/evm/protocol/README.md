# `@layerzerolabs/protocol-v2-evm-contracts`

LayerZero V2 EVM endpoint contracts: `EndpointV2`, `EndpointV2Alt`, `EndpointV2View` and the simple and blocked message libraries.

Copied byte for byte from `@layerzerolabs/lz-evm-protocol-v2` (`packages/layerzero-v2/evm/protocol`) in the old LayerZero-Labs/monorepo at `origin/cb/executor-upgrade` (`d976cafeaf`). Only `contracts/` and the Foundry tests are copied; the old deploy scripts, deployment records, typechain bindings and Hardhat tests are not.

## Build

`pnpm build` compiles with the old compiler settings (`hardhat.config.cjs`) into `artifacts/` (EVM), `artifacts-zk/` (zkSync) and `artifacts-tron/` (Tron), which the package publishes for consumers to read by path, e.g. `@layerzerolabs/protocol-v2-evm-contracts/artifacts/contracts/<Source>.sol/<Contract>.json`.

`pnpm test:snapshot:check` checks the compiled bytecode against `turbo-snapshot.lock.json`.

## Test

`pnpm test` runs the Foundry tests.
