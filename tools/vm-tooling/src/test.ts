import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type * as vitest from 'vitest';

import type { VersionCombination } from './config';
import { type Image } from './config';
import { getImageTag, getImageUri } from './utils/docker';

const COMMAND_TIMEOUT = 5 * 60_000;
const PULL_TIMEOUT = 10 * 60_000;
const VERSION_TEST_TIMEOUT = 15 * 60_000;

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

/** Run a no-op command in the image to trigger a pull if it's not available locally. */
const ensureDockerImageExists = async (imageUri: string): Promise<void> => {
    await runCommand('docker', ['run', '--rm', '--entrypoint', 'true', imageUri], PULL_TIMEOUT);
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

            describe(getImageTag(image), () => {
                let imageUri: string;

                beforeAll(async () => {
                    imageUri = await getImageUri(image, '_');
                    await ensureDockerImageExists(imageUri);
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
};
