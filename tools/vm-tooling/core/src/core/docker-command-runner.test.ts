import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';

import type { ChainContext } from '../context';
import { executeToolCommand } from './tool-executor';

const originalEnv = vi.hoisted(() => {
    const saved = {
        PATH: globalThis.process.env.PATH,
        HOME: globalThis.process.env.HOME,
        DOCKER_DEFAULT_PLATFORM: globalThis.process.env.DOCKER_DEFAULT_PLATFORM,
    };
    globalThis.process.env.VM_TOOLING_REGISTRY = 'registry.example';
    globalThis.process.env.VM_TOOLING_IMAGE_DIRECTORY = 'layerzerolabs';
    return saved;
});

const EXPIRED_TOKEN_STDERR =
    'Error response from daemon: Head "https://registry.example/v2/layerzerolabs/fake-tooling/manifests/pinned-1.0.0": denied: Your authorization token has expired. Reauthenticate and try again.';

const fakeDockerScript = (logPath: string): string =>
    [
        '#!/bin/sh',
        `printf '%s\\n' "$*" >> '${logPath}'`,
        'case "$1" in',
        '    version)',
        `        printf '%s\\n' '{"Client":{"ApiVersion":"1.56","Os":"darwin","Arch":"arm64"},"Server":{"Os":"linux","Arch":"arm64","ApiVersion":"1.56"}}'`,
        '        ;;',
        '    image)',
        `        printf '%s\\n' 'Error response from daemon: No such image' >&2`,
        '        exit 1',
        '        ;;',
        '    pull)',
        `        printf '%s\\n' '${EXPIRED_TOKEN_STDERR}' >&2`,
        '        exit 1',
        '        ;;',
        'esac',
        'exit 0',
        '',
    ].join('\n');

const fakeContext: ChainContext<'fake'> = {
    tools: [{ name: 'pinned', dockerPlatform: 'linux/amd64' }],
    images: { fake: { name: 'fake', versions: { pinned: '1.0.0' } } },
    versionCombinations: [{ images: { pinned: 'fake' } }],
};

describe.sequential('executeToolCommand with a fake docker executable on PATH', () => {
    let directory: string;
    let logPath: string;

    beforeAll(async () => {
        directory = await mkdtemp(path.join(tmpdir(), 'vm-tooling-docker-runner-'));
        logPath = path.join(directory, 'docker.log');
        const dockerPath = path.join(directory, 'docker');
        await writeFile(dockerPath, fakeDockerScript(logPath));
        await chmod(dockerPath, 0o755);
        await writeFile(logPath, '');
        process.env.PATH = `${directory}${path.delimiter}${originalEnv.PATH ?? ''}`;
        process.env.HOME = directory;
        delete process.env.DOCKER_DEFAULT_PLATFORM;
    });

    afterAll(async () => {
        process.env.PATH = originalEnv.PATH;
        process.env.HOME = originalEnv.HOME;
        if (originalEnv.DOCKER_DEFAULT_PLATFORM !== undefined) {
            process.env.DOCKER_DEFAULT_PLATFORM = originalEnv.DOCKER_DEFAULT_PLATFORM;
        }
        await rm(directory, { recursive: true, force: true });
    });

    it('the real Docker runner reads the pull stderr, gives the login hint, and reads no index', async ({
        expect,
    }) => {
        await expect(
            executeToolCommand(fakeContext, 'pinned', [], {
                cwd: process.cwd(),
                volumes: [],
                env: [],
            }),
        ).rejects.toThrow(
            [
                'Docker image not available:',
                '  - Image: registry.example/layerzerolabs/fake-tooling:pinned-1.0.0 (pull failed)',
                '  - ECR auth expired. Run: pnpm localnet login',
            ].join('\n'),
        );

        const commands = (await readFile(logPath, 'utf8')).trim().split('\n');
        expect(commands.map((command) => command.split(' ')[0])).toEqual([
            'version',
            'image',
            'image',
            'pull',
        ]);
    });
});
