# LayerZero V2 Starknet Contracts

The Cairo sources for the LayerZero protocol v2 on Starknet. This package compiles with Scarb and publishes nothing but the sources themselves.

TypeScript bindings — ABI, CASM, Sierra, and the verification artifact — are published separately from the sibling `sdk` directory, as `@layerzerolabs/protocol-v2-starknet-sdk`. That package reads both the Cairo sources and the compiled classes from here at build time, so a change to any contract requires rebuilding it as well; Turbo handles that ordering.

## Local development

Scarb runs through `lz-tool` in a pinned Docker image, so no local Scarb install is needed. Run these from this directory:

```sh
pnpm build  # scarb --release build
pnpm test   # scarb test
pnpm lint   # scarb fmt --check && scarb lint --test
```
