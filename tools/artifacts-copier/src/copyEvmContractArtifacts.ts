import { join } from 'path';

import { copyBuildInfo, copyHardhatCompilationArtifact, pkgToFolderName } from './utils';

// Copy hardhat artifacts and buildInfos
// With contractPath, you can copy nested OZ artifacts
export const copyEvmContractArtifacts = async (
    resolvePath: (relativePathWithinPackage: string) => string,
    rootPath: string,
    pkgName: string,
    contractName: string,
    contractPath: string = 'contracts',
) => {
    return copyContractArtifacts(
        resolvePath,
        rootPath,
        pkgName,
        contractName,
        contractPath,
        'artifacts',
    );
};

export const copyZkSyncContractArtifacts = async (
    resolvePath: (relativePathWithinPackage: string) => string,
    rootPath: string,
    pkgName: string,
    contractName: string,
    contractPath: string = 'contracts',
) => {
    return copyContractArtifacts(
        resolvePath,
        rootPath,
        pkgName,
        contractName,
        contractPath,
        'artifacts-zk',
    );
};

const copyContractArtifacts = async (
    resolvePath: (relativePathWithinPackage: string) => string,
    rootPath: string,
    pkgName: string,
    contractName: string,
    contractPath: string = 'contracts',
    artifactsDirName: string,
) => {
    const pkgFolderName = pkgToFolderName(pkgName);
    await copyHardhatCompilationArtifact({
        resolvePath,
        rootPath,
        fromPkg: pkgName,
        relativeArtifactPath: join(
            artifactsDirName,
            contractPath,
            `${contractName}.sol`,
            `${contractName}.json`,
        ),
        destRelativePath: join(artifactsDirName, pkgFolderName, contractName, 'abiBytecode.json'),
    });
    await copyBuildInfo({ resolvePath, rootPath, artifactsDirName, pkgName, contractName });
};
