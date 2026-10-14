# @layerzerolabs/lz-v2-protocol-solana

Solana protocol bindings for LayerZero V2.

## Executor V3 and Transaction V1 (`/v3`)

`@layerzerolabs/lz-v2-protocol-solana/v3` adds receive/compose discovery for OApps that implement
`lz_*_types_v3`, and Transaction V1 compilation with Solana Kit. The root entry is unchanged and
does not load Kit.

Discovery simulates `lz_*_types_info`, then simulates a top-level create of a throwaway,
caller-signed scratch account together with the `lz_*_types_v3` planner, reads the scratch's
post-simulation data and builds the delivery, re-simulating larger if the planner reports that
the plan did not fit. There is no V1/V2 fallback and no lookup-table metadata: `executeV3` and
`composeV3` fail for an OApp that does not answer V3, while `Executor.execute` and
`Executor.compose` keep their V2/V1 behavior. `compileTransactionV1` requires every compute and
heap budget explicitly.

`pnpm test` runs the planner and Transaction V1 unit suites.
