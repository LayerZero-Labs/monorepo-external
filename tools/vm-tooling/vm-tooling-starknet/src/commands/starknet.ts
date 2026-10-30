import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

import {
    copyScarbArtifact,
    readScarbArtifact,
    readScarbArtifactIndex,
} from '@layerzerolabs/build-utils-starknet';

const contractClassSchema = z.object({ abi: z.array(z.unknown()) });

const buildKebabCase = (name: string): string =>
    name.replaceAll(/[A-Z]/g, (character) => `-${character.toLowerCase()}`).replace(/^-/, '');

const buildCamelCase = (name: string): string =>
    name.replace(/^[A-Z]/, (character) => character.toLowerCase());

export const buildTypescriptSdk = async ({
    scarbPackage,
    buildDirectory,
    srcDirectory,
}: {
    scarbPackage: string;
    buildDirectory: string;
    srcDirectory: string;
}): Promise<void> => {
    const abiDirectory = join(srcDirectory, 'abi');
    const casmDirectory = join(srcDirectory, 'casm');
    const sierraDirectory = join(srcDirectory, 'sierra');

    const artifactIndex = await readScarbArtifactIndex({ buildDirectory, scarbPackage });

    const contracts = artifactIndex.contracts.map(({ contract_name, artifacts }) => ({
        name: buildCamelCase(contract_name),
        basename: buildKebabCase(contract_name),
        artifacts,
    }));

    await mkdir(abiDirectory, { recursive: true });
    await mkdir(casmDirectory, { recursive: true });
    await mkdir(sierraDirectory, { recursive: true });

    for (const { name, basename, artifacts } of contracts) {
        const sierraPath = join(buildDirectory, artifacts.sierra);
        const sierraLabel = `Sierra class for contract ${name}`;
        const { abi } = await readScarbArtifact({
            filePath: sierraPath,
            artifactLabel: sierraLabel,
            schema: contractClassSchema,
        });

        await writeFile(
            join(abiDirectory, `${basename}.ts`),
            `export const ${name} = ${JSON.stringify(abi)} as const`,
        );
        await copyScarbArtifact({
            sourcePath: join(buildDirectory, artifacts.casm),
            destinationPath: join(casmDirectory, `${basename}.json`),
            artifactLabel: `CASM class for contract ${name}`,
        });
        await copyScarbArtifact({
            sourcePath: sierraPath,
            destinationPath: join(sierraDirectory, `${basename}.json`),
            artifactLabel: sierraLabel,
        });
    }

    await writeFile(
        join(srcDirectory, 'abi.ts'),
        contracts.map(({ basename }) => `export * from "./abi/${basename}.js";`).join('\n'),
    );

    await writeFile(
        join(srcDirectory, 'casm.ts'),
        contracts
            .map(
                ({ name, basename }) =>
                    `export { default as ${name} } from "./casm/${basename}.json";`,
            )
            .join('\n'),
    );

    await writeFile(
        join(srcDirectory, 'sierra.ts'),
        contracts
            .map(
                ({ name, basename }) =>
                    `export { default as ${name} } from "./sierra/${basename}.json";`,
            )
            .join('\n'),
    );
};
