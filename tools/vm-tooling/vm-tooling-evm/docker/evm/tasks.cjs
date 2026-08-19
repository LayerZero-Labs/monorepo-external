const { task } = require('hardhat/config');
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names');
const { TronSolcCompilerDownloader } = require('@layerzerolabs/hardhat-tron/dist/downloader');
const {
    ZksolcCompilerDownloader,
} = require('@matterlabs/hardhat-zksync-solc/dist/src/compile/downloader');
const {
    ZkVmSolcCompilerDownloader,
} = require('@matterlabs/hardhat-zksync-solc/dist/src/compile/zkvm-solc-downloader');
const { getCompilersDir } = require('hardhat/internal/util/global-dir');
const compilerVersions = require('./compiler-versions.json');

task('download:all', 'Download all solc variants').setAction(async (_, hre) => {
    for (const version of compilerVersions.solc.solc) {
        await hre.run('download:solc', { solcVersion: version });
    }

    for (const version of compilerVersions.tronSolc) {
        await hre.run('download:tronsolc', { solcVersion: version });
    }

    for (const zksolcVersion of compilerVersions.zksolc) {
        await hre.run('download:zksolc', { zksolcVersion });
    }

    for (const { era: eraVersion, solc: solcVersion } of compilerVersions.zkVmSolc) {
        await hre.run('download:zk-vm-solc', { eraVersion, solcVersion });
    }
});

task('download:solc', 'Download vanilla solc')
    .addParam('solcVersion', 'The solc version to download')
    .setAction(({ solcVersion }, hre) =>
        hre.run(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, { solcVersion, quiet: false }),
    );

task('download:tronsolc', 'Download Tron soljson')
    .addParam('solcVersion', 'The tron solc version to download')
    .setAction(async ({ solcVersion }) => {
        await new TronSolcCompilerDownloader(solcVersion).getCompilerPath();
    });

task('download:zksolc', 'Download the zksolc compiler')
    .addParam('zksolcVersion', 'The zksolc version to download')
    .setAction(async ({ zksolcVersion }) => {
        // hardhat-zksync-solc 1.3.2 keeps a process-wide singleton.
        ZksolcCompilerDownloader._instance = undefined;

        const downloader = await ZksolcCompilerDownloader.getDownloaderWithVersionValidated(
            zksolcVersion,
            '',
            await getCompilersDir(),
        );

        await downloader.downloadCompiler();
    });

task('download:zk-vm-solc', 'Download the zkvm-solc compiler')
    .addParam('eraVersion', 'The era version to download')
    .addParam('solcVersion', 'The solc version to download')
    .setAction(async ({ eraVersion, solcVersion }) => {
        const downloader = await ZkVmSolcCompilerDownloader.getDownloaderWithVersionValidated(
            eraVersion,
            solcVersion,
            await getCompilersDir(),
        );

        await downloader.downloadCompiler();
    });
