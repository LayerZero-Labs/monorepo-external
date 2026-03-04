#!/usr/bin/env bash
set -euo pipefail

if [[ "${1-}" == "-h" || "${1-}" == "--help" || $# -ne 2 ]]; then
  echo "Usage: flatten_dir.sh <srcDir> <destDir>" >&2
  echo "Example: flatten_dir.sh contracts ./artifacts-flattened-contracts" >&2
  exit 1
fi

SRC_DIR="$1"
DEST_DIR="$2"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "Source directory not found: $SRC_DIR" >&2
  exit 2
fi

# Normalize to remove trailing slashes
SRC_DIR="${SRC_DIR%/}"
DEST_DIR="${DEST_DIR%/}"

# Iterate over all .sol files under SRC_DIR
COUNT=0
while IFS= read -r CONTRACT_PATH; do
  COUNT=$((COUNT + 1))
  REL_PATH="${CONTRACT_PATH#${SRC_DIR}/}"
  # Change extension to .flattened.sol and mirror directories in dest
  DEST_PATH="$DEST_DIR/${REL_PATH%.sol}.flattened.sol"
  mkdir -p "$(dirname "$DEST_PATH")"
  flatten.sh "$CONTRACT_PATH" "$DEST_PATH"
done < <(find "$SRC_DIR" -type f -name "*.sol" | sort)

if [[ $COUNT -eq 0 ]]; then
  echo "No .sol files found under: $SRC_DIR" >&2
  exit 0
fi

echo "Flattened $COUNT contract(s) from $SRC_DIR into $DEST_DIR"
