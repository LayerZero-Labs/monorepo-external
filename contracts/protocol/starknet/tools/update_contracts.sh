#!/bin/sh

# TODO Remove this file when we complete the contracts and migrate all of them.

set -e

cd "$(dirname "$0")/.."

rm -rf layerzero
rm -rf libs
rm -rf tmp

git clone --depth 1 ssh://git@github.com/LayerZero-Labs/EPv2-Starknet tmp

cp -r tmp/layerzero .
cp -r tmp/libs .
cp -r tmp/README.md .

# Update Scarb.toml paths to use node_modules
update_scarb_toml() {
    local file="$1"
    if [ -f "$file" ]; then
        sed -i '' 's|\.\.\/libs\/lz_utils|..\/..\/node_modules\/@layerzerolabs\/protocol-starknet-v2\/libs\/lz_utils|g' "$file"
        sed -i '' 's|\.\.\/layerzero|..\/..\/node_modules\/@layerzerolabs\/protocol-starknet-v2\/layerzero|g' "$file"
    fi
}

# ============================================================================
# Sync oft to contracts/oft
# ============================================================================

OFT_DEST="../../oft/starknet/oft/contracts/oft"

if [ -d "tmp/oft" ]; then
    rm -rf "$OFT_DEST/src"
    rm -rf "$OFT_DEST/tests"
    cp -r tmp/oft/src "$OFT_DEST/"
    cp -r tmp/oft/tests "$OFT_DEST/"

    update_scarb_toml "$OFT_DEST/Scarb.toml"
else
    echo "Warning: oft not found in tmp/oft"
fi

# ============================================================================
# Sync oft_adapter to contracts/oft
# ============================================================================

OFT_ADAPTER_DEST="../../oft/starknet/oft_adapter/contracts/oft_adapter"

if [ -d "tmp/oft_adapter" ]; then
    rm -rf "$OFT_ADAPTER_DEST/src"
    rm -rf "$OFT_ADAPTER_DEST/tests"
    cp -r tmp/oft_adapter/src "$OFT_ADAPTER_DEST/"
    cp -r tmp/oft_adapter/tests "$OFT_ADAPTER_DEST/"

    update_scarb_toml "$OFT_ADAPTER_DEST/Scarb.toml"
else
    echo "Warning: oft_adapter not found in tmp/oft_adapter"
fi

# ============================================================================
# Sync oft_mint_burn to contracts/oft
# ============================================================================

OFT_MINT_BURN_DEST="../../oft/starknet/oft_mint_burn/contracts/oft_mint_burn"

if [ -d "tmp/oft_mint_burn" ]; then
    rm -rf "$OFT_MINT_BURN_DEST/src"
    rm -rf "$OFT_MINT_BURN_DEST/tests"
    cp -r tmp/oft_mint_burn/src "$OFT_MINT_BURN_DEST/"
    cp -r tmp/oft_mint_burn/tests "$OFT_MINT_BURN_DEST/"

    update_scarb_toml "$OFT_MINT_BURN_DEST/Scarb.toml"
else
    echo "Warning: oft_mint_burn not found in tmp/oft_mint_burn"
fi

# ============================================================================
# Cleanup
# ============================================================================

# Remove Scarb.lock files
find layerzero libs -name Scarb.lock -delete 2>/dev/null || true

rm -rf tmp
