import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const artifactIndexSchema = z.object({
    contracts: z
        .array(
            z.object({
                // Becomes both a generated filename and a TypeScript identifier.
                contract_name: z
                    .string()
                    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Contract name must be a valid identifier'),
                artifacts: z.object({ sierra: z.string(), casm: z.string() }),
            }),
        )
        .min(1, 'Scarb artifact index declares no contracts'),
});

const contractClassSchema = z.object({ abi: z.array(z.unknown()) });

const buildKebabCase = (name: string): string =>
    name.replaceAll(/[A-Z]/g, (character) => `-${character.toLowerCase()}`).replace(/^-/, '');

const buildCamelCase = (name: string): string =>
    name.replace(/^[A-Z]/, (character) => character.toLowerCase());

/**
 * Reads and validates a JSON file produced by `scarb build`.
 *
 * These artifacts are machine-generated and never hand-edited, so any failure here means the
 * Scarb build is broken. Node's default SyntaxError names neither the file nor the build step,
 * which is why every failure mode below interpolates the path.
 */
const readScarbArtifact = async <T>({
    filePath,
    artifactLabel,
    schema,
}: {
    filePath: string;
    artifactLabel: string;
    schema: z.ZodType<T>;
}): Promise<T> => {
    let contents: string;
    try {
        contents = await readFile(filePath, 'utf-8');
    } catch (cause) {
        if ((cause as { code?: string }).code === 'ENOENT') {
            throw new Error(
                `${artifactLabel} not found at ${filePath}. Build the Scarb package first.`,
                { cause },
            );
        }
        throw new Error(`Cannot read ${artifactLabel} at ${filePath}`, { cause });
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(contents);
    } catch (cause) {
        throw new Error(`${artifactLabel} at ${filePath} is not valid JSON`, { cause });
    }

    const validated = schema.safeParse(parsed);
    if (!validated.success) {
        throw new Error(
            `${artifactLabel} at ${filePath} does not match the expected schema:\n${z.prettifyError(validated.error)}`,
            { cause: validated.error },
        );
    }

    return validated.data;
};

export const buildTypescriptSdk = async ({
    scarbPackage,
    targetDirectory,
    srcDirectory,
}: {
    scarbPackage: string;
    targetDirectory: string;
    srcDirectory: string;
}): Promise<void> => {
    const buildDirectory = join(targetDirectory, 'release');
    const abiDirectory = join(srcDirectory, 'abi');
    const casmDirectory = join(srcDirectory, 'casm');
    const sierraDirectory = join(srcDirectory, 'sierra');

    const artifactIndex = await readScarbArtifact({
        filePath: join(buildDirectory, `${scarbPackage}.starknet_artifacts.json`),
        artifactLabel: 'Scarb artifact index',
        schema: artifactIndexSchema,
    });

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
        const { abi } = await readScarbArtifact({
            filePath: sierraPath,
            artifactLabel: `Sierra class for contract ${name}`,
            schema: contractClassSchema,
        });

        await writeFile(
            join(abiDirectory, `${basename}.ts`),
            `export const ${name} = ${JSON.stringify(abi)} as const`,
        );
        await copyFile(
            join(buildDirectory, artifacts.casm),
            join(casmDirectory, `${basename}.json`),
        );
        await copyFile(sierraPath, join(sierraDirectory, `${basename}.json`));
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
