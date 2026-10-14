import fs from 'fs';
import { join } from 'path';

import { copyBuildInfo, copyHardhatCompilationArtifact, pkgToFolderName } from './utils';

export const copyTronContractArtifacts = async (
    resolvePath: (relativePathWithinPackage: string) => string,
    rootPath: string,
    pkgName: string,
    contractName: string,
    contractPath: string = 'contracts',
) => {
    const artifactsDirName = 'artifacts-tron';
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

    const destRelativePath = join(
        artifactsDirName,
        pkgFolderName,
        contractName,
        `${contractName}.flattened.sol`,
    );
    await copyHardhatCompilationArtifact({
        resolvePath,
        rootPath,
        fromPkg: pkgName,
        relativeArtifactPath: join(
            'artifacts-flattened-contracts',
            contractPath,
            `${contractName}.flattened.sol`,
        ),
        destRelativePath,
    });

    const flattenedSolContent = await fs.promises.readFile(destRelativePath, 'utf8');
    const flattenedSolBase64 = Buffer.from(flattenedSolContent).toString('base64');
    const flattenedSolObject = {
        flattenedSolSourceBase64: flattenedSolBase64,
    };
    await fs.promises.writeFile(
        join(artifactsDirName, pkgFolderName, contractName, `${contractName}.flattened.sol.json`),
        JSON.stringify(flattenedSolObject),
    );
};
