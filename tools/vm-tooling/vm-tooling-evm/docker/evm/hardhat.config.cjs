require('hardhat-deploy');
require('@layerzerolabs/hardhat-tron');
require('@matterlabs/hardhat-zksync-deploy');
require('@matterlabs/hardhat-zksync-solc');
require('./tasks.cjs');

const compilerVersions = require('./compiler-versions.json');

const settings = {
    optimizer: {
        enabled: true,
        runs: 20000,
    },
};

const defaultSolc = ['0.8.20', '0.8.22', '0.8.23'];

module.exports = {
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
        compilers: defaultSolc.map((version) => ({
            version,
            eraVersion: compilerVersions.solc.era,
            settings,
        })),
    },
    zksolc: {
        version: compilerVersions.zksolc[0],
        compilerSource: 'binary',
        settings,
    },
    tronSolc: {
        enable: true,
        compilers: defaultSolc.map((version) => ({
            version,
            settings,
        })),
    },
};
