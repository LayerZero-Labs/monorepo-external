const { task } = require('hardhat/config');
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names');
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

    await hre.run('download:zksolc', { zksolcVersion: compilerVersions.zksolc });

    for (const version of compilerVersions.zkVmSolc.solc) {
        await hre.run('download:zk-vm-solc', {
            eraVersion: compilerVersions.zkVmSolc.era,
            solcVersion: version,
        });
    }
});

// Tron compilers are provided by the `@layerzerolabs/hardhat-tron` plugin.
task('download:solc', 'Download the vanilla and Tron solc')
    .addParam('solcVersion', 'The solc version to download')
    .setAction(({ solcVersion }, hre) =>
        hre.run(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, { solcVersion, quiet: false }),
    );

task('download:zksolc', 'Download the zksolc compiler')
    .addParam('zksolcVersion', 'The zksolc version to download')
    .setAction(async ({ zksolcVersion }) => {
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
