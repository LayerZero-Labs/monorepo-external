const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const semver = require('semver');
const { extendConfig, extendEnvironment, subtask, task } = require('hardhat/config');
const t = require('hardhat/builtin-tasks/task-names');
const { Artifacts } = require('hardhat/internal/artifacts');
const { getAllFilesMatching } = require('hardhat/internal/util/fs-utils');
const { Mutex } = require('hardhat/internal/vendor/await-semaphore');
const { HardhatPluginError } = require('hardhat/plugins');
const { CompilationJobCreationErrorReason } = require('hardhat/types');

const PLUGIN_NAME = '@layerzerolabs/vm-tooling-evm/hardhat-tron';

class TronSolcPluginError extends HardhatPluginError {
    constructor(message, parentError) {
        super(PLUGIN_NAME, message, parentError);
    }
}

const TRON_SOLC_SHA256 = {
    '0.7.6': '12854e8dfb8809e9afb224fa8f46f59368a49ff21c394d3198a730a2dbc3cb12',
    '0.8.11': 'cb71022d1132a3596f6e3b5341fa093dedfc753d6929bea6d7192d88c66a210f',
    '0.8.20': '3842487fd8c7752e9aa21aeafa12172523b8d37b83b65c34c40c51f4fe8ba58c',
    '0.8.22': '246b2a0f2e5f7e9611cbf91558a57b14958c9d0120740432a0f409e86d93d131',
    '0.8.23': 'dd7d7d3d9976176e130823d7c253985599c3a79b17defac081350993a367000b',
    '0.8.24': '527b5363b50eee33b9d45a1619ccd3511e6304637867135396969ac93bc67116',
};

const expectedSha256 = (version) => {
    const sha256 = TRON_SOLC_SHA256[version];
    if (sha256 === undefined) {
        throw new TronSolcPluginError(
            `no pinned SHA-256 for tron solc v${version}; add it to TRON_SOLC_SHA256`,
        );
    }
    return sha256;
};

const verifySha256 = (version, soljsonPath) => {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(soljsonPath)).digest('hex');
    if (actual !== expectedSha256(version)) {
        fs.rmSync(soljsonPath, { force: true });
        throw new TronSolcPluginError(
            `tron solc v${version} SHA-256 mismatch (got ${actual}); deleted ${soljsonPath}`,
        );
    }
};

const DOWNLOAD_TIMEOUT_MS = 300_000;

const tronSolcPath = (version) =>
    path.join(os.homedir(), '.tron', 'solc', `soljson_v${version}.js`);

const mutex = new Mutex();

const solcWrapper = () =>
    require(
        require.resolve('solc/wrapper', {
            paths: [path.dirname(require.resolve('hardhat/package.json'))],
        }),
    );

const readVersions = (soljsonPath) => {
    const solc = solcWrapper()(require(soljsonPath));
    const longVersion = solc.version() ?? '';
    return [longVersion.match(/\d+\.\d+\.\d+/)?.toString() ?? '', longVersion];
};

const verifyCompiler = (version, soljsonPath) => {
    const [shortVersion, longVersion] = readVersions(soljsonPath);
    if (shortVersion !== version) {
        throw new TronSolcPluginError(
            `${soljsonPath} reports tron solc v${shortVersion}, expected v${version}`,
        );
    }
    return [shortVersion, longVersion];
};

const download = async (version, soljsonPath) => {
    const url = `https://tronsuper.github.io/tron-solc-bin/bin/soljson_v${version}.js`;
    fs.mkdirSync(path.dirname(soljsonPath), { recursive: true });
    console.log(soljsonPath, ' <- ', url);
    const tmpPath = `${soljsonPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal });
        if (!response.ok || response.body == null) {
            throw new TronSolcPluginError(
                `Could not download tron solc v${version}, code ${response.status}`,
            );
        }
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tmpPath), { signal });
        verifySha256(version, tmpPath);
        fs.renameSync(tmpPath, soljsonPath);
    } catch (error) {
        fs.rmSync(tmpPath, { force: true });
        if (error instanceof TronSolcPluginError) throw error;
        throw new TronSolcPluginError(`could not download tron solc: ${error.message}`, error);
    }
};

const getTronSolc = (version) =>
    mutex.use(async () => {
        expectedSha256(version);
        const soljsonPath = tronSolcPath(version);
        if (fs.existsSync(soljsonPath)) {
            verifySha256(version, soljsonPath);
        } else {
            console.info('Downloading tron solc compiler...');
            await download(version, soljsonPath);
        }
        const [shortVersion, longVersion] = verifyCompiler(version, soljsonPath);
        return { soljsonPath, shortVersion, longVersion };
    });

const getTronSolcPath = async (version) => (await getTronSolc(version)).soljsonPath;

const tronPaths = (artifactsPath, cachePath) => [
    artifactsPath.endsWith('-tron') ? artifactsPath : `${artifactsPath}-tron`,
    cachePath.endsWith('-tron') ? cachePath : `${cachePath}-tron`,
];

const evmPaths = (artifactsPath, cachePath) => [
    artifactsPath.endsWith('-tron') ? artifactsPath.slice(0, -5) : artifactsPath,
    cachePath.endsWith('-tron') ? cachePath.slice(0, -5) : cachePath,
];

const replaceSolidityVersion = (line, versionRemapping) => {
    const match = line.match(/^pragma\s+solidity\s+(.+);$/);
    if (match === null) return line;
    const versionSpec = match[1].trim().split(/\s+/);
    const remapped = versionSpec.map((versionPart) => {
        const rangeMatch = versionPart.match(/([\^>=<~]*)\s*(\d+\.\d+\.\d+)/);
        if (rangeMatch === null) return versionPart;
        const target = versionRemapping.get(rangeMatch[2]);
        return target ? `${rangeMatch[1].trim()}${target}` : versionPart;
    });
    return remapped.some((v, i) => v !== versionSpec[i])
        ? `pragma solidity ${remapped.join(' ')};`
        : line;
};

const tronSolidityConfigs = new Map();

const tronSolidityConfig = (solidityConfig, tronConfig) => {
    const config = {
        version: tronConfig.version,
        settings: {
            ...solidityConfig.settings,
            optimizer: {
                ...solidityConfig.settings?.optimizer,
                ...tronConfig.settings?.optimizer,
            },
            metadata: {
                ...solidityConfig.settings?.metadata,
                ...tronConfig.settings?.metadata,
            },
        },
    };
    const key = JSON.stringify(config);
    if (!tronSolidityConfigs.has(key)) tronSolidityConfigs.set(key, config);
    return tronSolidityConfigs.get(key);
};

const isTronEnabled = (hre) => !!hre.network.tron && hre.config.tronSolc.enable;

extendConfig((config, userConfig) => {
    const { tronSolc } = userConfig;
    const versionRemapping = new Map();
    for (const remapping of tronSolc?.versionRemapping ?? []) {
        for (const version of remapping) {
            if (semver.valid(version) == null) {
                throw new TronSolcPluginError(`invalid version in versionRemapping ${version}`);
            }
        }
        versionRemapping.set(remapping[0], remapping[1]);
    }
    config.tronSolc = {
        enable: !!tronSolc?.enable,
        compilers: tronSolc?.compilers ?? [],
        filter: new Set(tronSolc?.filter ?? []),
        versionRemapping,
    };
});

extendEnvironment((hre) => {
    if (!hre.network.config.tron || hre.config.tronSolc.enable !== true) return;
    hre.network.tron = hre.network.config.tron;
    const [artifactsPath, cachePath] = tronPaths(
        hre.config.paths.artifacts,
        hre.config.paths.cache,
    );
    hre.config.paths.artifacts = artifactsPath;
    hre.config.paths.cache = cachePath;
    hre.artifacts = new Artifacts(artifactsPath);
});

subtask(t.TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS, async ({ sourcePath }, hre, runSuper) => {
    const { filter } = hre.config.tronSolc;
    if (!isTronEnabled(hre) || filter.size === 0) return runSuper();
    return getAllFilesMatching(
        sourcePath ?? hre.config.paths.sources,
        (f) => f.endsWith('.sol') && filter.has(path.basename(f, path.extname(f))),
    );
});

subtask(
    t.TASK_COMPILE_SOLIDITY_GET_COMPILATION_JOB_FOR_FILE,
    async ({ dependencyGraph, file }, hre, runSuper) => {
        const compilationJob = await runSuper();
        if (!isTronEnabled(hre) || 'reason' in compilationJob) return compilationJob;

        const { compilers } = hre.config.tronSolc;
        const pragmas = dependencyGraph
            .getTransitiveDependencies(file)
            .flatMap(({ dependency }) => dependency.content.versionPragmas);
        const versionRange = [...new Set([...file.content.versionPragmas, ...pragmas])].join(' ');
        const version = semver.maxSatisfying(
            compilers.map((c) => c.version),
            versionRange,
        );
        if (version === null) {
            return {
                reason: CompilationJobCreationErrorReason.NO_COMPATIBLE_SOLC_VERSION_FOUND,
                file,
            };
        }

        const tronConfig = compilers.find((c) => c.version === version);
        compilationJob.solidityConfig = tronSolidityConfig(
            compilationJob.solidityConfig,
            tronConfig,
        );
        return compilationJob;
    },
);

subtask(t.TASK_COMPILE_SOLIDITY_RUN_SOLC, async (_, hre, runSuper) => {
    if (!isTronEnabled(hre)) return runSuper();
    throw new TronSolcPluginError('only solc-js is supported by the Tron compiler');
});

subtask(t.TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async ({ solcVersion }, hre, runSuper) => {
    if (!isTronEnabled(hre)) return runSuper();
    console.info(`Compiling contracts with tron solc v${solcVersion}`);
    const { soljsonPath, shortVersion, longVersion } = await getTronSolc(solcVersion);
    return { compilerPath: soljsonPath, isSolcJs: true, version: shortVersion, longVersion };
});

subtask(t.TASK_COMPILE_SOLIDITY_LOG_DOWNLOAD_COMPILER_START, async (_, hre, runSuper) => {
    if (!isTronEnabled(hre)) return runSuper();
});

subtask(t.TASK_COMPILE_SOLIDITY_READ_FILE, async (_, hre, runSuper) => {
    const { versionRemapping } = hre.config.tronSolc;
    if (!isTronEnabled(hre) || versionRemapping.size === 0) return runSuper();
    const content = await runSuper();
    return content
        .split(/\r?\n/)
        .map((line) => replaceSolidityVersion(line, versionRemapping))
        .join('\n');
});

task(t.TASK_CLEAN, async (_, hre, runSuper) => {
    const { artifacts, cache } = hre.config.paths;
    for (const [artifactsPath, cachePath] of [
        tronPaths(artifacts, cache),
        evmPaths(artifacts, cache),
    ]) {
        fs.rmSync(cachePath, { recursive: true, force: true });
        fs.mkdirSync(cachePath, { recursive: true });
        fs.rmSync(artifactsPath, { recursive: true, force: true });
    }
    return runSuper();
});

module.exports = { getTronSolcPath };
