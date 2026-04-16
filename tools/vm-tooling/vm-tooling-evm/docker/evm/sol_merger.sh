#!/usr/bin/env bash
set -euo pipefail

if [[ "${1-}" == "-h" || "${1-}" == "--help" || $# -lt 2 ]]; then
  echo "Usage: sol_merger.sh <contractPath> <destPath>" >&2
  echo "Example: sol_merger.sh contracts/MyOFT.sol artifacts-flattened-contracts/MyOFT.flattened.sol" >&2
  exit 1
fi

CONTRACT_PATH="$1"
DEST_CONTRACT_PATH="$2"

CONTRACT_NAME="${CONTRACT_PATH##*/}"
DEST_PATH="${DEST_CONTRACT_PATH%/*}"

if ! sol-merger "$CONTRACT_PATH" "$DEST_PATH"; then
  echo "Flattening failed for: $CONTRACT_PATH"
  exit 2
fi

mv "$DEST_PATH/$CONTRACT_NAME" "$DEST_CONTRACT_PATH"
echo "Flattened $CONTRACT_PATH -> $DEST_CONTRACT_PATH"
