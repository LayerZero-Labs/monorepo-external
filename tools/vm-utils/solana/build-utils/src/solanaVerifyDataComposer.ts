import * as fs from 'fs/promises';
import path from 'path';

import { getFullyQualifiedRepoRootPath } from './utils/files';

const solanaVerifyVersion = '0.4.11'; // TODO extract from the solana-verify --version using  lz-tool

export const prepareVerificationArtifactSolana = async (args: {
    packageFolder: string;
    libraryName: string;
    commitHash: string;
    repositoryUrl: string;
    cargoArgsCallback: (address: string) => string[];
}) => {
    const { packageFolder, libraryName, commitHash, repositoryUrl, cargoArgsCallback } = args;
    const idlFilePath = path.join(packageFolder, `target/idl/${libraryName}.json`);
    console.log(`✅ Reading IDL from: ${idlFilePath}`);
    const idl = await fs.readFile(idlFilePath, 'utf-8');
    const { address } = JSON.parse(idl);
    const sourceCodeFolderWithinRepository = path.relative(
        await getFullyQualifiedRepoRootPath(),
        packageFolder,
    );
    const verificationArtifact = {
        repositoryUrl: repositoryUrl,
        sourceCodeFolderWithinRepository,
        commitHash: commitHash,
        libraryName: libraryName,
        solanaVerifyVersion,
        bpfFlag: false,
        cargoArgs: cargoArgsCallback(address),
    };
    const verificationArtifactFolder = path.join(packageFolder, `target/verification`);
    await fs.mkdir(verificationArtifactFolder, { recursive: true });
    await fs.writeFile(
        path.join(verificationArtifactFolder, `${libraryName}.json`),
        JSON.stringify(verificationArtifact, null, 2),
    );
};
