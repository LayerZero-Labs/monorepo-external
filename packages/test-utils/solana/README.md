# @layerzerolabs/test-utils-solana

Shared test infrastructure for Solana integration tests. Boots a surfpool localnet (in Docker via
`lz-tool`) offline from a pre-built base snapshot that already carries the LZ protocol, plus error
assertion helpers.

## How it works

`globalSetup` builds a base snapshot **once**: it extracts the LZ protocol `.so` from the snapshot
image, boots surfpool, writes those programs in, runs `initInfrastructure` a single time, and exports
a state-only `base.json`. Each test file then boots its own surfpool **offline from that base.json**
(protocol already deployed and initialized) and writes its own consumer programs on top via
`surfnet_writeProgram` — no per-file protocol redeploy and no per-file `initInfrastructure`.

```text
globalSetup (once)                         per-test-file
┌──────────────────────────────┐     ┌──────────────────────────────────┐
│ 1. extract protocol .so      │     │ startValidator()                 │
│    from snapshot image       │     │   └─ lz-tool → surfpool (Docker) │
│    └─ cached target/programs │     │      --offline --snapshot        │
│ 2. buildBaseSnapshot:        │     │        target/base.json          │
│    boot surfpool, write .so, │     │   └─ writeProgram consumer .so   │
│    initInfrastructure once,  │     │ ... run tests ...                │
│    export state-only         │     │ teardown()                       │
│    └─ cached target/base.json│     │   └─ docker kill                 │
└──────────────────────────────┘     └──────────────────────────────────┘
```

The base snapshot replaces the old per-file `solana-test-validator` boot + genesis `--bpf-program`
load + per-file `initInfrastructure`. surfpool boots from it in ~1s.

## Usage

### Consumer test file (e.g. counter-oapp)

```ts
// tests/global-setup.ts
export { globalSetup as default } from '@layerzerolabs/test-utils-solana';

// tests/01-counter.test.ts
import { createInfraEnv, createSignerFromSeed } from '@layerzerolabs/test-utils-solana';

// Only your own program — the LZ protocol comes from base.json, already deployed + initialized.
const programs = [{ id: MY_PROGRAM_ID, soPath: 'target/deploy/my_program.so' }];

const infra = await createInfraEnv({ programs });
// ... run tests ... (no initInfrastructure call: it is baked into base.json)
await infra.teardown();
```

### Error assertions (separate subpath — does not pull vitest into globalSetup)

```ts
import {
    expectProgramError,
    expectUnauthorizedError,
} from '@layerzerolabs/test-utils-solana/assertions';
```

## Artifact extraction

`globalSetup` extracts the LZ protocol `.so` from the `solana-snapshot:manual-3.0.167` Docker image on
first run (`solana program dump`, cached in `target/programs/`), then builds `base.json` from them
(cached in `target/`). Both steps are local and offline after the first run. Both `target/programs/`
and `target/base.json` are gitignored — generated, not committed.

Program IDs are sourced from `@layerzerolabs/lz-solana-sdk-v2` — no hardcoded addresses.

### Why extract from the snapshot instead of downloading from devnet?

The previous approach dumped programs from devnet (`solana program dump -u devnet`) inside Docker,
which introduced a network dependency: CI failures when devnet was unreachable or rate-limited, and
concurrent Docker pulls during turbo test execution caused timeouts. The snapshot image contains the
same programs and extracting from it is local, fast, and deterministic.

### Why build a base snapshot instead of booting the snapshot image directly?

The snapshot image is only a `.so` source. We boot surfpool against our own `base.json` so the test
state is exactly what `buildBaseSnapshot` produces (the 7 protocol programs + a single
`initInfrastructure`), with no mainnet account residue, and so each test file gets an identical
deterministic starting point at ~1s boot.

## Key exports

| Export                             | Path           | Description                                       |
| ---------------------------------- | -------------- | ------------------------------------------------- |
| `createInfraEnv`                   | `.`            | Boot surfpool from base.json (protocol pre-init)  |
| `initInfrastructure`               | `.`            | Idempotent LZ protocol init (used by globalSetup) |
| `startValidator`                   | `.`            | Low-level surfpool lifecycle                      |
| `sendAndConfirm`                   | `.`            | Transaction helper bridging UMI + web3.js         |
| `createSignerFromSeed`             | `.`            | Deterministic keypair from seed string            |
| `LZ_PROGRAMS`                      | `.`            | Protocol program name/ID list                     |
| `SRC_EID`, `DST_EID`               | `.`            | Test EIDs (1, 2)                                  |
| `endpoint`, `uln`, `executor`, ... | `.`            | Pre-instantiated SDK clients                      |
| `expectProgramError`               | `./assertions` | Assert Anchor program errors                      |
| `expectUnauthorizedError`          | `./assertions` | Assert missing RBAC role                          |
| `expectErrorMessage`               | `./assertions` | Assert error string contains message              |

## Configuration

surfpool runs from a dedicated lean image selected by `lz-tool --surfpool-version` (see
`spawnValidator` in `src/helpers/validator.ts`), decoupled from the anchor toolchain. The harness
needs no `Anchor.toml` and no per-consumer version flags.

## Updating artifacts

When the snapshot image version changes (e.g. `solana-3.0.168`), update `SNAPSHOT_IMAGE` in
`src/global-setup.ts` and delete `target/programs/` and `target/base.json` (+ the `.snapshot-version`
/ `.base-version` markers) to force re-extraction and a base rebuild.
