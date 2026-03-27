// side-effect imports, these create the artifacts-tron and artifacts-zksync directories
import _hardhat_zksync from '@matterlabs/hardhat-zksync-solc';
// required for hardhat-tron
import _hardhat_deploy from 'hardhat-deploy';

import _hardhat_tron from '@layerzerolabs/hardhat-tron';
// FIXME correctly typing this requires hardhat extensions for tron etc, is there a better way?
// FIXME can we extend the base hardhat config?
const config = {
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
    paths: {
        root: process.cwd(),
        cache: 'hh-cache',
        artifacts: './artifacts',
        sources: 'contracts',
        tests: 'test',
        deploy: 'deploy',
        deployments: 'deployments',
    },
    spdxLicenseIdentifier: {
        overwrite: false,
        runOnCompile: true,
    },
    solidity: {
        compilers: [
            {
                version: '0.8.26',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 750,
                    },
                    viaIR: true,
                    evmVersion: 'paris',
                },
            },
        ],
        overrides: {
            'contracts/ERC20Plus.sol': {
                version: '0.8.26',
                settings: {
                    optimizer: { enabled: true, runs: 1_000_000 },
                    viaIR: true,
                    evmVersion: 'paris',
                },
            },
        },
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
};

export default config;
