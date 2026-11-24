import { defineConfig } from '@wagmi/cli';
import fs from 'fs';
import { fileURLToPath } from 'url';

const collectContractsInputs = async (artifactsPackageFolder, artifactsFolderName) => {
    const artifactsFolder = `${fileURLToPath(artifactsPackageFolder)}/${artifactsFolderName}`;
    const artifacts = await fs.promises.readdir(artifactsFolder, { recursive: true });
    const seenContracts = new Set();
    return await Promise.all(
        artifacts
            .filter((a) => a.includes('.json'))
            .filter((a) => !a.includes('.dbg'))
            .map(async (artifact) => {
                const jsonFile = await fs.promises.readFile(
                    `${artifactsFolder}/${artifact}`,
                    'utf-8',
                );
                const jsonArtifact = JSON.parse(jsonFile);
                const result = {
                    name: jsonArtifact.contractName,
                    abi: jsonArtifact.abi,
                    generateFileName: `${artifact.replace('.json', '').replace('.sol', '')}Abi.ts`,
                };
                if (seenContracts.has(result.generateFileName)) {
                    throw new Error(
                        `Contract ${result.generateFileName} being defined multiple times`,
                    );
                }
                seenContracts.add(result.generateFileName);
                return result;
            }),
    );
};

export const createWagmiConfigs = async (configs) => {
    const allEntries = [];
    for (const cfg of configs) {
        const {
            artifactsPackageFolder,
            artifactsFolderName = 'artifacts/contracts',
            generatedFolderName = 'generated-abi',
        } = cfg;
        const contractsWagmiInputs = await collectContractsInputs(
            artifactsPackageFolder,
            artifactsFolderName,
        );
        contractsWagmiInputs.forEach((c) => {
            allEntries.push({
                out: `./src/${generatedFolderName}/${c.generateFileName}`,
                contracts: [c],
                plugins: [],
            });
        });
    }
    return defineConfig(allEntries);
};
