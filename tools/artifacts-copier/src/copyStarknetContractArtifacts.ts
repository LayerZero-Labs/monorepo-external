import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    copyScarbArtifact,
    getScarbArtifactIndexFileName,
    readScarbArtifactIndex,
} from '@layerzerolabs/build-utils-starknet';

import type { ResolvePath } from './types';

export const copyStarknetContractArtifacts = async ({
    resolvePath,
    packageRoot,
    packageName,
    scarbPackage,
}: {
    resolvePath: ResolvePath;
    packageRoot: string;
    packageName: string;
    scarbPackage: string;
}) => {
    const contractsPackageRoot = path.dirname(resolvePath(`${packageName}/package.json`));
    const sourceDir = path.join(contractsPackageRoot, 'target', 'release');
    const destinationDir = path.join(packageRoot, 'artifacts', 'release');

    // The build directory also holds Scarb's incremental cache and the Sierra library, so only the
    // classes the index declares are copied.
    const { contracts } = await readScarbArtifactIndex({ buildDirectory: sourceDir, scarbPackage });
    const artifactPaths = [
        getScarbArtifactIndexFileName(scarbPackage),
        ...contracts.flatMap(({ artifacts }) => [artifacts.sierra, artifacts.casm]),
    ];

    for (const artifactPath of artifactPaths) {
        const destinationPath = path.join(destinationDir, artifactPath);

        // The index may name classes in subdirectories, so each destination parent has to exist.
        await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
        await copyScarbArtifact({
            sourcePath: path.join(sourceDir, artifactPath),
            destinationPath,
            artifactLabel: `Scarb artifact ${artifactPath}`,
        });
    }

    console.log(
        `Copied Starknet ${scarbPackage} classes (${artifactPaths.length} files): ${sourceDir} -> ${destinationDir}`,
    );
};
