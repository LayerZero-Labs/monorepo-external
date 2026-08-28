const Module = require('node:module');

const versions = require('./compiler-versions.json');

// Workspace hardhat configs resolve their own plugin copy, not NODE_PATH.
const UTILS = '/hardhat-zksync-solc/dist/src/utils.js';

const latestZksolc = versions.zksolc.at(-1);
const latestEra = versions.zkVmSolc.at(-1).era;

const getLatestRelease = async (_owner, repo, _userAgent, fallback) => {
    // Resolve `version: 'latest'`, and the ceiling for a pinned zksolc version.
    if (repo === 'zksolc-bin') {
        return latestZksolc;
    }
    // Fill omitted `eraVersion` when zksolc >= 1.5.0.
    if (repo === 'era-solidity') {
        // Dummy prefix; the plugin keeps only the era after `-`.
        return `0.0.0-${latestEra}`;
    }
    return fallback;
};

const getLatestEraVersion = async () => latestEra;

const origLoad = Module._load;
Module._load = function lzOfflineZkSyncLoad(request, parent, isMain) {
    const exported = origLoad.apply(this, arguments);
    if (exported?.getLatestEraVersion === getLatestEraVersion) {
        return exported;
    }

    let resolved;
    try {
        resolved = Module._resolveFilename(request, parent, false);
    } catch {
        return exported;
    }

    if (!resolved.endsWith(UTILS)) {
        return exported;
    }

    exported.getLatestRelease = getLatestRelease;
    exported.getLatestEraVersion = getLatestEraVersion;
    return exported;
};
