import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as vitest from 'vitest';

import { executeToolCommand } from '@layerzerolabs/vm-tooling';

import { images, tools, versionCombinations } from './config';

const testEnv = await vitest.vi.hoisted(async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const saved = {
        PATH: globalThis.process.env.PATH,
        HOME: globalThis.process.env.HOME,
        DOCKER_DEFAULT_PLATFORM: globalThis.process.env.DOCKER_DEFAULT_PLATFORM,
    };
    const home = mkdtempSync(join(tmpdir(), 'lz-solana-volume-locks-'));
    globalThis.process.env.HOME = home;
    globalThis.process.env.VM_TOOLING_REGISTRY = 'registry.example';
    globalThis.process.env.VM_TOOLING_IMAGE_DIRECTORY = 'layerzerolabs';
    delete globalThis.process.env.DOCKER_DEFAULT_PLATFORM;
    return { home, saved };
});

const ARG_SEPARATOR = '\u001f';

const fakeDockerScript = ({
    logPath,
    lockDirectory,
}: {
    logPath: string;
    lockDirectory: string;
}): string =>
    [
        '#!/bin/sh',
        'locks=',
        `[ "$1" = run ] && locks=$(ls '${lockDirectory}' 2>/dev/null | tr '\\n' ' ')`,
        `{ printf '%s${ARG_SEPARATOR}' "locks=$locks" "$@"; printf '\\n'; } >> '${logPath}'`,
        'case "$1 $2" in',
        "    'version --format')",
        `        printf '%s\\n' '{"Client":{"ApiVersion":"1.51"},"Server":{"ApiVersion":"1.51"}}'`,
        '        ;;',
        "    'image inspect')",
        `        printf '%s\\n' 'linux/amd64'`,
        '        ;;',
        "    'container create')",
        `        printf '%s\\n' 'probe-container'`,
        '        ;;',
        'esac',
        'exit 0',
        '',
    ].join('\n');

interface DockerCall {
    args: string[];
    locks: string[];
}

const parseDockerLog = (log: string): DockerCall[] =>
    log
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => {
            const [locks = '', ...args] = line.split(ARG_SEPARATOR).slice(0, -1);
            return {
                args,
                locks: locks
                    .replace(/^locks=/, '')
                    .split(' ')
                    .filter((lock) => lock !== ''),
            };
        });

vitest.describe.sequential('Solana tool runs', () => {
    let logPath: string;

    vitest.beforeAll(async () => {
        const directory = path.join(testEnv.home, 'bin');
        logPath = path.join(directory, 'docker.log');
        await mkdir(directory, { recursive: true });
        const dockerPath = path.join(directory, 'docker');
        await writeFile(
            dockerPath,
            fakeDockerScript({
                logPath,
                lockDirectory: path.join(testEnv.home, '.cache', 'vm-tooling', 'locks'),
            }),
        );
        await chmod(dockerPath, 0o755);
        process.env.PATH = `${directory}${path.delimiter}${testEnv.saved.PATH ?? ''}`;
    });

    vitest.afterAll(async () => {
        for (const [name, value] of Object.entries(testEnv.saved)) {
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
        await rm(testEnv.home, { recursive: true, force: true });
    });

    vitest.it.for(['anchor', 'solana', 'solana-verify'])(
        '%s runs its container with no lock held and no prepare container',
        async (toolName, { expect }) => {
            await writeFile(logPath, '');

            await executeToolCommand({ tools, images, versionCombinations }, toolName, [], {
                cwd: process.cwd(),
                volumes: [],
                env: [],
                defaultVolumesEnabled: true,
            });

            const calls = parseDockerLog(await readFile(logPath, 'utf8'));
            const runs = calls.filter(({ args }) => args[0] === 'run');
            expect(runs).toHaveLength(1);
            expect(runs[0]?.locks).toEqual([]);
            expect(calls.filter(({ args }) => args[0] === 'create' || args[0] === 'start')).toEqual(
                [],
            );
        },
    );
});
