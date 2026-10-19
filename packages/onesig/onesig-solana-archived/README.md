# @layerzerolabs/onesig-solana-archived

The previous OneSig Solana implementation, preserved from `@layerzerolabs/onesig-solana`.
The canonical implementation now lives in [`../onesig-solana`](../onesig-solana).

This package retains its original program ID (`5XDrnPsfpZ29v7DRrUtUBJ3yr5n1mhSUDyEzPuAvakHv`),
Anchor 1.0.2 toolchain, build artifacts, and audit history.

Its local validator uses `onesig-solana-archived-validator` on host ports 8799/8800. The canonical
package uses a separate validator on 8897/8898, so both test suites can run independently.
