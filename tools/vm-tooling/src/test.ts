import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type * as vitest from 'vitest';
import * as z from 'zod';

import type { VersionCombination } from './config';
import { type Image } from './config';
import { getImageTag, getImageUri } from './utils/docker';

const COMMAND_TIMEOUT = 5 * 60_000;
const MANIFEST_TEST_TIMEOUT = 20_000;
const VERSION_TEST_TIMEOUT = 15 * 60_000;
const PULL_TIMEOUT = 10 * 60_000;

const slsaSchema = z.object({
    SLSA: z.object({}),
});

// TODO Require provenance by GitHub Actions.
const provenanceSchema = z.object({
    ['linux/amd64']: slsaSchema,
    ['linux/arm64']: slsaSchema,
});

const runCommand = async (
    command: string,
    args: string[],
    timeout = COMMAND_TIMEOUT,
): Promise<string> =>
    (
        await promisify(execFile)(command, args, {
            timeout,
            killSignal: 'SIGKILL', // Force kill if timeout
        })
    ).stdout.trim();

const isImageCached = async (uri: string): Promise<boolean> => {
    try {
        await runCommand('docker', ['image', 'inspect', uri]);
        return true;
    } catch {
        return false;
    }
};

const pullLocks = new Map<string, Promise<void>>();

const ensureImagePulled = async (uri: string): Promise<void> => {
    const existingPull = pullLocks.get(uri);
    if (existingPull) {
        console.log(`⏳ Waiting for concurrent pull: ${uri}`);
        return existingPull;
    }

    const pullPromise = (async () => {
        if (await isImageCached(uri)) {
            console.log(`✅ Image already cached: ${uri}`);
            return;
        }
        console.log(`📥 Pulling image: ${uri}`);
        await runCommand('docker', ['pull', uri], PULL_TIMEOUT);
    })().finally(() => pullLocks.delete(uri));

    pullLocks.set(uri, pullPromise);
    return pullPromise;
};

export const testTools = (
    { describe, expect, it, beforeAll }: typeof vitest,
    images: Record<string, Image>,
    _versionCombinations: VersionCombination<string>[],
    versionCommands: Record<string, string[]>,
): void => {
    describe('Docker image IDs', () => {
        for (const [name, image] of Object.entries(images)) {
            it(`has an image ID of ${name}`, () => {
                expect([image.name, getImageTag(image, '-')].join(':')).toBe(name);
            });
        }
    });

    describe('Tool versions', () => {
        for (const literalImage of Object.values(images)) {
            const image: Image = literalImage;

            if (image.unreleased) {
                continue;
            }

            describe(getImageTag(image), () => {
                let imageUri: string;

                beforeAll(async () => {
                    imageUri = await getImageUri(image, '_');
                    await ensureImagePulled(imageUri);
                }, PULL_TIMEOUT);

                for (const [tool, expectedVersion] of Object.entries(image.versions)) {
                    it(
                        `should have ${tool} of version ${expectedVersion}`,
                        async () => {
                            if (!(versionCommands[tool] instanceof Array)) {
                                throw new Error('Missing version command');
                            }

                            const version = await runCommand('docker', [
                                'run',
                                '--rm',
                                '--privileged',
                                imageUri,
                                ...versionCommands[tool],
                            ]);

                            expect(version).toContain(expectedVersion);
                        },
                        VERSION_TEST_TIMEOUT,
                    );
                }
            });
        }
    });

    describe('Docker image manifests', () => {
        for (const [id, image] of Object.entries(images)) {
            if (image.unreleased) {
                continue;
            }

            it(
                `has a valid manifest for ${id}`,
                async () => {
                    const { stdout } = await promisify(execFile)('docker', [
                        'buildx',
                        'imagetools',
                        'inspect',
                        '--format',
                        '{{ json .Provenance }}',
                        await getImageUri(image, '_'),
                    ]);

                    expect(provenanceSchema.safeParse(JSON.parse(stdout)).success).toBe(true);
                },
                MANIFEST_TEST_TIMEOUT,
            );
        }
    });
};
