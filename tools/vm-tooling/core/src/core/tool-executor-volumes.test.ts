import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';

import type { VolumeMapping } from '../config';
import { volumeMappingSchema } from '../config';
import type { ChainContext } from '../context';
import { buildLockFilePath } from './lock';
import { executeToolCommand } from './tool-executor';

const testEnv = await vi.hoisted(async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const saved = {
        PATH: globalThis.process.env.PATH,
        HOME: globalThis.process.env.HOME,
        DOCKER_DEFAULT_PLATFORM: globalThis.process.env.DOCKER_DEFAULT_PLATFORM,
        npm_package_name: globalThis.process.env.npm_package_name,
    };
    const home = mkdtempSync(join(tmpdir(), 'vm-tooling-volumes-'));
    globalThis.process.env.HOME = home;
    globalThis.process.env.npm_package_name = 'volumes-test';
    globalThis.process.env.VM_TOOLING_REGISTRY = 'registry.example';
    globalThis.process.env.VM_TOOLING_IMAGE_DIRECTORY = 'layerzerolabs';
    delete globalThis.process.env.DOCKER_DEFAULT_PLATFORM;
    return { home, saved };
});

const ARG_SEPARATOR = '\u001f';
const CARGO_PATH = '/usr/local/cargo';
const LOCKED_CARGO_VOLUME = 'lz-tooling-cache-default-cargo-fake-tool-1.0.0';
const PACKAGE_RELATIVE_PATH = 'packages/volumes-test';

const createWorkspacePackage = async (parent: string): Promise<string> => {
    const repo = await mkdtemp(path.join(parent, 'workspace-'));
    const packageRoot = path.join(repo, PACKAGE_RELATIVE_PATH);
    await mkdir(packageRoot, { recursive: true });
    await writeFile(path.join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    await writeFile(
        path.join(repo, 'pnpm-lock.yaml'),
        ["lockfileVersion: '9.0'", '', 'importers:', `  ${PACKAGE_RELATIVE_PATH}: {}`, ''].join(
            '\n',
        ),
    );
    await writeFile(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({ name: 'volumes-test', version: '0.0.0' }),
    );
    return realpath(packageRoot);
};

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

const mountsOf = (args: readonly string[]): string[] =>
    args.flatMap((arg, index) => (args[index - 1] === '-v' ? [arg] : []));

const isCacheMount = (mount: string): boolean => mount.startsWith('lz-tooling-cache-');

describe.sequential('executeToolCommand volume mounts and locks', () => {
    const overrideName = 'override-cargo';
    let logPath: string;

    const context: ChainContext<'fake'> = {
        tools: [
            {
                name: 'fake-tool',
                defaultVolumes: [
                    {
                        type: 'isolate',
                        containerPath: CARGO_PATH,
                        name: 'default-cargo',
                        toolchainKeyed: true,
                        locked: true,
                    },
                    { type: 'isolate', containerPath: '/nocopy', name: 'nocopy', nocopy: true },
                    {
                        type: 'isolate',
                        containerPath: '/nocopy-read-only',
                        name: 'nocopy-read-only',
                        nocopy: true,
                        readOnly: true,
                    },
                    { type: 'isolate', containerPath: '/plain', name: 'plain' },
                    {
                        type: 'isolate',
                        containerPath: '/plain-read-only',
                        name: 'plain-read-only',
                        readOnly: true,
                    },
                ],
            },
        ],
        images: { fake: { name: 'fake', versions: { 'fake-tool': '1.0.0' } } },
        versionCombinations: [{ images: { 'fake-tool': 'fake' } }],
    };

    beforeAll(async () => {
        const directory = path.join(testEnv.home, 'bin');
        logPath = path.join(directory, 'docker.log');
        await mkdir(directory, { recursive: true });
        const dockerPath = path.join(directory, 'docker');
        await writeFile(
            dockerPath,
            fakeDockerScript({
                logPath,
                lockDirectory: path.dirname(buildLockFilePath('fake')),
            }),
        );
        await chmod(dockerPath, 0o755);
        await writeFile(logPath, '');
        process.env.PATH = `${directory}${path.delimiter}${testEnv.saved.PATH ?? ''}`;
    });

    afterAll(async () => {
        for (const [name, value] of Object.entries(testEnv.saved)) {
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
        await rm(testEnv.home, { recursive: true, force: true });
    });

    const runTool = async (
        volumes: VolumeMapping[],
        defaultVolumesEnabled = true,
    ): Promise<DockerCall> => {
        const packageRoot = await createWorkspacePackage(testEnv.home);
        const packageMount = `${packageRoot}:/workspace/${PACKAGE_RELATIVE_PATH}`;

        await executeToolCommand(context, 'fake-tool', [], {
            cwd: packageRoot,
            volumes,
            env: [],
            defaultVolumesEnabled,
        });

        const runs = parseDockerLog(await readFile(logPath, 'utf8')).filter(
            ({ args }) => args[0] === 'run' && mountsOf(args).includes(packageMount),
        );
        if (runs.length !== 1 || !runs[0]) {
            throw new Error(
                `Expected one docker run that mounts ${packageMount}, got ${runs.length}`,
            );
        }
        return runs[0];
    };

    it('mounts a nocopy volume with the nocopy option, after ro when it is read-only, and other volumes without it', async ({
        expect,
    }) => {
        const run = await runTool([]);

        expect(mountsOf(run.args).filter(isCacheMount)).toEqual([
            `${LOCKED_CARGO_VOLUME}:${CARGO_PATH}`,
            'lz-tooling-cache-nocopy-volumes-test:/nocopy:nocopy',
            'lz-tooling-cache-nocopy-read-only-volumes-test:/nocopy-read-only:ro,nocopy',
            'lz-tooling-cache-plain-volumes-test:/plain',
            'lz-tooling-cache-plain-read-only-volumes-test:/plain-read-only:ro',
        ]);
    });

    it('holds the lock of a locked default volume while its container runs', async ({ expect }) => {
        const run = await runTool([]);

        expect(run.locks).toEqual([LOCKED_CARGO_VOLUME]);
    });

    it('runs a --volume isolate::<path>:<name> override of a locked default volume with no lock', async ({
        expect,
    }) => {
        const run = await runTool([
            volumeMappingSchema.parse({
                type: 'isolate',
                containerPath: CARGO_PATH,
                name: overrideName,
            }),
        ]);

        expect(mountsOf(run.args).filter((mount) => mount.endsWith(`:${CARGO_PATH}`))).toEqual([
            `lz-tooling-cache-${overrideName}-volumes-test:${CARGO_PATH}`,
        ]);
        expect(run.locks).toEqual([]);
    });

    it('runs with --no-default-volumes with no lock and no cache volume mount', async ({
        expect,
    }) => {
        const run = await runTool([], false);

        expect(mountsOf(run.args).filter(isCacheMount)).toEqual([]);
        expect(run.locks).toEqual([]);
    });
});
