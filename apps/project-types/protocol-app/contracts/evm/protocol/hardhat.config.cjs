// Compiler settings copied from the old LayerZero-Labs/monorepo package's hardhat.config.ts
// (and the shared `@layerzerolabs/hardhat-config` it spread), so the build reproduces the
// published artifacts byte for byte. Deploy, network and key settings are left out.
require('@matterlabs/hardhat-zksync-solc');
// `hardhat-deploy` sets `metadata.useLiteralContent: true`, which the published metadata hashes
// depend on.
require('hardhat-deploy');
require('@layerzerolabs/vm-tooling-evm/hardhat-tron');

const optimizer = {
    enabled: true,
    runs: 20000,
};

module.exports = {
    paths: {
        cache: 'hh-cache',
        artifacts: './artifacts',
        sources: 'contracts',
    },
    zksolc: {
        version: '1.3.22',
        compilerSource: 'binary',
        settings: {},
    },
    solidity: {
        compilers: [
            {
                version: '0.8.22',
                eraVersion: '1.0.1',
                settings: {
                    optimizer,
                },
            },
            {
                version: '0.8.20',
                settings: {
                    optimizer,
                },
            },
        ],
    },
    tronSolc: {
        enable: true,
        versionRemapping: [['0.8.22', '0.8.20']],
        compilers: [
            {
                version: '0.8.20',
                settings: {
                    optimizer,
                },
            },
        ],
    },
    networks: {
        'zksync-mainnet': {
            url: 'https://zksync2-mainnet.zksync.io',
            ethNetwork: 'https://eth-mainnet.public.blastapi.io',
            zksync: true,
        },
        'tron-mainnet': {
            url: 'http://127.0.0.1:8514/jsonrpc',
            tron: true,
        },
    },
};
