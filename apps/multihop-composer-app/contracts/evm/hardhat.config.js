module.exports = {
    paths: {
        cache: 'hh-cache',
    },
    solidity: {
        compilers: [
            {
                version: '0.8.26',
                settings: {
                    evmVersion: 'cancun',
                    viaIR: true,
                    optimizer: {
                        enabled: true,
                        runs: 20_000,
                    },
                    metadata: { useLiteralContent: true },
                },
            },
        ],
    },
};
