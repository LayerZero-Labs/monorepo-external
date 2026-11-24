# EVM Tests Generator

Provides a test framework for verifying the bytecode and CBOR metadata of EVM, ZKSync, and Tron contracts.

## Test Framework

Snapshots are declared with `ArtifactSnapshotSettings` (EVM / Tron) and `ZKSyncArtifactSnapshotSettings` (ZKSync). Each contract may set `evmSnapshot`, `zksyncSnapshot`, and/or `tronSnapshot`.

Test files using `generateArtifactSnapshotTests` must be named `artifact-snapshots.test.ts`.

Example usage:

```ts
const snapshots = {
    ERC20MintBurnUpgradeable: {
        artifactGetter: getERC20MintBurnUpgradeableArtifact,
        evmSnapshot: {
            bytecodeHash: '0x758c540c2a332a241ffec4cc52c2f2d5eb0ab8ce70701803cad9de15a63843e6',
            cborMetadata:
                'a2646970667358221220438394674bfba8afd172c8e5e97a351ec6193c77ba1304a6616833ff3660f90d64736f6c6343000816',
            solcVersion: '0.8.22',
            compiler: {
                evmVersion: 'paris',
                optimizer: { enabled: true, runs: 20_000 },
            },
        },
        zksyncSnapshot: {
            bytecodeHash: '0x...',
            cborMetadata: 'a264...', // or `metadataHash` for zksolc < 1.5.13
            solcVersion: 'zkVM-0.8.22-1.0.2',
            zksolcVersion: '1.5.15',
            compiler: { evmVersion: 'paris', optimizer: { enabled: true, mode: '3' } },
        },
    },
};

generateArtifactSnapshotTests(snapshots);
```

### Bytecode hash vs deployed-bytecode hash

Each EVM / Tron snapshot must set exactly one of:

- **`bytecodeHash`** — keccak256 of the creation bytecode with CBOR metadata stripped. Preferred whenever CBOR detection succeeds on the creation bytecode.
- **`deployedBytecodeHash`** — keccak256 of the deployed (runtime) bytecode with CBOR metadata stripped. Use this when the creation bytecode has trailing constants after the runtime CBOR (e.g. OpenZeppelin v4 / v5 proxies) that break CBOR detection. `cborMetadata` is then extracted from the deployed bytecode.

ZKSync snapshots only accept `bytecodeHash` — EraVM has no creation/runtime split.

### ZKSync metadata and compiler version

ZKSync snapshots use `cborMetadata` for `zksolc >= 1.5.13` and `metadataHash` (raw keccak256 of the zksolc `Metadata` struct) for older versions — exactly one of the two.

`zksolcVersion` pins the binary: `solcVersion` (e.g. `zkVM-0.8.23-1.0.1`) only encodes the solc version and zkVM edition, so drift across zksolc releases wouldn't otherwise be caught.

## CLI

### `artifact` — extract from a build artifact

Extracts snapshot settings from Foundry artifacts, Hardhat build-info, or Hardhat deployment artifacts. ZKSync and Tron are auto-detected from artifact compiler versions. Falls back to `deployedBytecodeHash` automatically when creation CBOR detection fails or `appendCBOR: false` is set.

```bash
# Hardhat deployment artifact (from `hardhat-deploy`).
pnpm evm-tests-generator artifact ~/my-project/deployments/ethereum/MyContract.json

# Hardhat build-info (needs `-c <contract-name>` to locate bytecode).
pnpm evm-tests-generator artifact ~/my-project/artifacts/build-info/ca954277ceb6f1a6f0e969074ca66174.json -c ERC20MintBurnUpgradeable

# Foundry artifact.
pnpm evm-tests-generator artifact ~/my-project/out/ERC20MintBurnUpgradeable.sol/ERC20MintBurnUpgradeable.json
```

Prints a copy-pasteable object literal for your test file.

> **Note**
>
> The test options (build info) should be sourced from the original build repository, not from the build package that copies it.

### `bytecode` — extract from raw hex

Computes `bytecodeHash` and metadata from raw bytecode hex. Constructor arguments must be stripped before passing creation bytecode — they sit after the CBOR suffix and will cause detection to fail.

- `--target zksync` for EraVM bytecodes.
- `--deployed` when the hex is runtime bytecode; emits `deployedBytecodeHash` instead. Not supported with `--target zksync`.

> **Note:** `solcVersion` and `compiler` settings are not available from raw bytecode alone. Use the `artifact` command on the original build repository to obtain those fields.

```bash
# Manually fetched or parsed.
pnpm evm-tests-generator bytecode 0x6080604052...

# Deployed (runtime) bytecode from on-chain.
pnpm evm-tests-generator bytecode --deployed $(cast code 0xAABBCC... --rpc-url https://eth.llamarpc.com)

# Deploy transaction without constructor arguments. Using `cast` and `jq`.
pnpm evm-tests-generator bytecode $(cast tx 0x41e096bfa388f16216a5aa92267ae6123e4bb9608e3adea468c054430957e37b --rpc-url https://rpc.hyperliquid.xyz/evm --json | jq -r '.input')
```

## Rationale

Solidity compiler version, compiler settings, and bytecode should always match across contracts. That means the contract behaves in a completely identical way when it is migrated to another repository or when its packages are adjusted.

Sometimes, formatting, dependency remappings, or minor changes to the contract source code may result in different CBOR metadata, since that depends on the source code itself. Migrations should do a best-effort to ensure the CBOR metadata is the same, but it's not always possible or desirable.

Therefore, the following values are expected to always match the source of truth repositories:

| Value             | Match Expectation    |
| ----------------- | -------------------- |
| Solc Version      | Always fully match   |
| Compiler Settings | Always fully match   |
| Bytecode Hash     | Always fully match   |
| CBOR Metadata     | Best-effort to match |

## Bytecode Hash

In order to compare bytecode hashes, the metadata suffix is stripped before hashing, to allow distinguishing between on-chain behaviour matches (bytecode hash matches) and cosmetic matches (source code matches).

- **EVM / Tron**: strip the CBOR blob + 2-byte length suffix.
- **ZKSync**: strip the CBOR suffix (`zksolc >= 1.5.13`) or the last 32-byte word (older).
