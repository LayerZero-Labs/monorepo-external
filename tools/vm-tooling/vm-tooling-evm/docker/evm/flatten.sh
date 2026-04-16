#!/usr/bin/env bash
set -euo pipefail

if [[ "${1-}" == "-h" || "${1-}" == "--help" || $# -lt 2 ]]; then
  echo "Usage: flatten.sh <contractPath> <destPath>" >&2
  echo "Example: flatten.sh contracts/MyOFT.sol artifacts-flattened-contracts/MyOFT.flattened.sol" >&2
  exit 1
fi

CONTRACT_PATH="$1"
DEST_PATH="$2"

mkdir -p "$(dirname "$DEST_PATH")"

TMP_OUT="$(mktemp)"
if ! hardhat --config /hardhat/hardhat.default.config.js flatten "${CONTRACT_PATH}" 1>"$TMP_OUT"; then
  echo "Flattening failed for: $CONTRACT_PATH"
  if [[ -f "$TMP_OUT" ]]; then
    rm -f "$TMP_OUT"
  fi
  exit 2
fi

mv "$TMP_OUT" "$DEST_PATH"
chmod a+r "$DEST_PATH"
echo "Flattened $CONTRACT_PATH -> $DEST_PATH"
