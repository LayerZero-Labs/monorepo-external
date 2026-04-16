import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const artifactIndexSchema = z.object({
    contracts: z.array(
        z.object({
            contract_name: z.string(),
            artifacts: z.object({ sierra: z.string(), casm: z.string() }),
        }),
    ),
});

const buildKebabCase = (name: string): string =>
    name.replaceAll(/[A-Z]/g, (character) => `-${character.toLowerCase()}`).replace(/^-/, '');

const buildCamelCase = (name: string): string =>
    name.replace(/^[A-Z]/, (character) => character.toLowerCase());

export const buildTypescriptSdk = async (
    packageName: string,
    targetDirectory: string,
    srcDirectory: string,
): Promise<void> => {
    const buildDirectory = join(targetDirectory, 'release');
    const abiDirectory = join(srcDirectory, 'abi');
    const casmDirectory = join(srcDirectory, 'casm');
    const sierraDirectory = join(srcDirectory, 'sierra');

    await mkdir(abiDirectory, { recursive: true });
    await mkdir(casmDirectory, { recursive: true });
    await mkdir(sierraDirectory, { recursive: true });

    // Support multiple package names separated by commas
    const packageNames = packageName.split(',').map((name) => name.trim());

    // Read and merge contracts from all packages
    const allContracts: Array<{
        name: string;
        basename: string;
        artifacts: { sierra: string; casm: string };
    }> = [];

    for (const pkgName of packageNames) {
        const packageContracts = artifactIndexSchema
            .parse(
                JSON.parse(
                    await readFile(
                        join(buildDirectory, `${pkgName}.starknet_artifacts.json`),
                        'utf-8',
                    ),
                ),
            )
            .contracts.map(({ contract_name, artifacts }) => ({
                name: buildCamelCase(contract_name),
                basename: buildKebabCase(contract_name),
                artifacts,
            }));

        allContracts.push(...packageContracts);
    }

    const contracts = allContracts;

    for (const { name, basename, artifacts } of contracts) {
        const contractFilename = join(buildDirectory, artifacts.sierra);

        await writeFile(
            join(abiDirectory, `${basename}.ts`),
            `export const ${name} = ${JSON.stringify(JSON.parse(await readFile(contractFilename, 'utf-8')).abi)} as const`,
        );
        await copyFile(
            join(buildDirectory, artifacts.casm),
            join(casmDirectory, `${basename}.json`),
        );
        await copyFile(contractFilename, join(sierraDirectory, `${basename}.json`));
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
