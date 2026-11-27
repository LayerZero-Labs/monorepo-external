# @layerzerolabs/ton

LayerZero's fork of [@ton/ton](https://github.com/ton-org/ton), the TON client library. It uses zod 4.

It ships as ESM only. On Node 22.12 or later, `require` returns the same exports as `import`. It does not include the upstream specs or the test-only helpers (`createTestClient`, `createTestClient4`, `randomTestKey`, `highload/v3/MsgGenerator`).
