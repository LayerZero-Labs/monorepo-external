import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';

// Joined onto the build directory and read, so it has to stay inside it.
const artifactPathSchema = z
    .string()
    .min(1, 'Artifact path cannot be empty')
    .refine(
        (value) => !path.isAbsolute(value) && !value.split(/[/\\]/).includes('..'),
        'Artifact path must stay within the build directory',
    );

const scarbArtifactIndexSchema = z.object({
    contracts: z
        .array(
            z.object({
                // Becomes both a generated filename and a TypeScript identifier.
                contract_name: z
                    .string()
                    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Contract name must be a valid identifier'),
                artifacts: z.object({
                    sierra: artifactPathSchema,
                    casm: artifactPathSchema,
                }),
            }),
        )
        .min(1, 'Scarb artifact index declares no contracts'),
});

type ScarbArtifactIndex = z.infer<typeof scarbArtifactIndexSchema>;

export const getScarbArtifactIndexFileName = (scarbPackage: string): string =>
    `${scarbPackage}.starknet_artifacts.json`;

/**
 * A Scarb artifact is only ever absent because the step that produces it did not run: the Scarb
 * build for packages that compile their own Cairo, or the copy step for packages that consume
 * prebuilt classes. That is the one failure with an obvious fix worth naming.
 */
const scarbArtifactError = ({
    cause,
    artifactLabel,
    filePath,
    failureMessage,
}: {
    cause: unknown;
    artifactLabel: string;
    filePath: string;
    failureMessage: string;
}): Error =>
    new Error(
        (cause as { code?: string }).code === 'ENOENT'
            ? `${artifactLabel} not found at ${filePath}. Build the Scarb package first, or run the artifact copy step if this package consumes prebuilt classes.`
            : failureMessage,
        { cause },
    );

/**
 * Reads and validates a JSON file produced by `scarb build`.
 *
 * These artifacts are machine-generated and never hand-edited, so any failure here means the step
 * that produced them (the Scarb build or the artifact copy) is broken or did not run. Node's default
 * SyntaxError names neither the file nor the step, which is why every failure mode below
 * interpolates the path.
 */
export const readScarbArtifact = async <T>({
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
        contents = await fs.readFile(filePath, 'utf-8');
    } catch (cause) {
        throw scarbArtifactError({
            cause,
            artifactLabel,
            filePath,
            failureMessage: `Cannot read ${artifactLabel} at ${filePath}`,
        });
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

export const readScarbArtifactIndex = ({
    buildDirectory,
    scarbPackage,
}: {
    buildDirectory: string;
    scarbPackage: string;
}): Promise<ScarbArtifactIndex> =>
    readScarbArtifact({
        filePath: path.join(buildDirectory, getScarbArtifactIndexFileName(scarbPackage)),
        artifactLabel: 'Scarb artifact index',
        schema: scarbArtifactIndexSchema,
    });

export const copyScarbArtifact = async ({
    sourcePath,
    destinationPath,
    artifactLabel,
}: {
    sourcePath: string;
    destinationPath: string;
    artifactLabel: string;
}): Promise<void> => {
    try {
        await fs.copyFile(sourcePath, destinationPath);
    } catch (cause) {
        throw scarbArtifactError({
            cause,
            artifactLabel,
            filePath: sourcePath,
            failureMessage: `Cannot copy ${artifactLabel} from ${sourcePath}`,
        });
    }
};
