import * as fs from 'node:fs';
import * as path from 'node:path';

export const copySolanaContractArtifacts = async (
    resolvePath: (relativePathWithinPackage: string) => string,
    rootPath: string,
    pkgName: string,
    programName: string,
    rename?: string,
    isVerifiable?: boolean,
) => {
    // Resolve the Solana contract package root
    const contractPkgRoot = path.dirname(resolvePath(`${pkgName}/package.json`));

    // Setup paths
    const artifactsDir = path.join(rootPath, 'artifacts');
    const artifacts = { idl: 'json', [isVerifiable ? 'verifiable' : 'deploy']: 'so' };
    for (const [directory, fileExtension] of Object.entries(artifacts)) {
        const fileName = `${programName}.${fileExtension}`;
        const newFileName = `${rename || programName}.${fileExtension}`;
        const artifactSourcePath = path.join(contractPkgRoot, 'target', directory, fileName);
        const artifactDestPath = path.join(artifactsDir, newFileName);

        // Create artifacts directory if it doesn't exist
        await fs.promises.mkdir(artifactsDir, { recursive: true });

        // Copy the IDL file
        await fs.promises.copyFile(artifactSourcePath, artifactDestPath);

        console.log(
            `Copied Solana ${directory}/${fileExtension}: ${artifactSourcePath} -> ${artifactDestPath}`,
        );
    }
};
