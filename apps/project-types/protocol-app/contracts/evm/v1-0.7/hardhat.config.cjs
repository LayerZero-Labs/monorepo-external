// Compiler settings copied from the old LayerZero-Labs/monorepo lz-evm-v1-0.7 hardhat.config.ts,
// so the build reproduces the old artifacts byte for byte. Deploy, network and key settings are
// left out.
require('@layerzerolabs/vm-tooling-evm/hardhat-tron');

module.exports = {
    paths: {
        cache: 'hh-cache',
        artifacts: './artifacts',
        sources: 'contracts',
    },
    solidity: {
        compilers: [
            {
                version: '0.7.6',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 30000,
                    },
                    metadata: { useLiteralContent: true },
                },
            },
        ],
    },
    tronSolc: {
        enable: true,
        compilers: [
            {
                version: '0.7.6',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 10000,
                    },
                },
            },
        ],
    },
    networks: {
        'tron-mainnet': {
            url: 'http://127.0.0.1:8514/jsonrpc',
            tron: true,
        },
    },
};
