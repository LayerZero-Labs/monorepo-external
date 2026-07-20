require('@matterlabs/hardhat-zksync-solc');
// `hardhat-deploy` is required by `@layerzerolabs/hardhat-tron`.
require('hardhat-deploy');
require('@layerzerolabs/hardhat-tron');

module.exports = {
    paths: {
        cache: 'hh-cache',
    },
    solidity: {
        compilers: [
            {
                version: '0.8.26',
                settings: {
                    evmVersion: 'paris',
                    viaIR: true,
                    optimizer: {
                        enabled: true,
                        runs: 750,
                    },
                    // Making the implicit `hardhat-deploy` behaviour explicit.
                    // https://github.com/wighawag/hardhat-deploy/blob/v0.12.4/src/index.ts#L317
                    metadata: { useLiteralContent: true },
                },
            },
        ],
        overrides: {
            'contracts/ERC20Plus.sol': {
                version: '0.8.26',
                settings: {
                    evmVersion: 'paris',
                    viaIR: true,
                    optimizer: {
                        enabled: true,
                        runs: 1_000_000,
                    },
                    // `hardhat-deploy` does not support `overrides`.
                    metadata: { useLiteralContent: true },
                },
            },
        },
    },
    zksolc: {
        version: '1.5.15',
        compilerSource: 'binary',
        settings: {},
    },
    tronSolc: {
        enable: true,
        versionRemapping: [['0.8.22', '0.8.20']],
        compilers: [
            {
                version: '0.8.20',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 750,
                    },
                },
            },
        ],
        // `@layerzerolabs/hardhat-tron` does not support `overrides`.
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
