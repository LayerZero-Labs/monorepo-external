import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installDependencies, runBuild } from '../src/buildUtils';

vi.mock('node:child_process', () => ({
    spawn: vi.fn(),
}));

const spawnMock = vi.mocked(spawn);
const originalCI = process.env.CI;

const mockSuccessfulCommands = (): void => {
    spawnMock.mockImplementation((() => {
        const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
        child.stderr = new EventEmitter();
        queueMicrotask(() => child.emit('close', 0));
        return child;
    }) as typeof spawn);
};

describe('build utilities', () => {
    beforeEach(() => {
        spawnMock.mockReset();
        mockSuccessfulCommands();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
        if (originalCI === undefined) {
            delete process.env.CI;
        } else {
            process.env.CI = originalCI;
        }
        vi.restoreAllMocks();
    });

    it('builds generated directories and their workspace dependencies', async () => {
        await runBuild('/repo', { directories: ['/repo/apps/projects/example'] });

        expect(spawnMock).toHaveBeenCalledWith(
            'pnpm',
            ['turbo:run', 'build', '--filter', '{./apps/projects/example/**}...'],
            { cwd: '/repo', stdio: 'inherit' },
        );
    });

    it('retains the package-local build when no directories are provided', async () => {
        await runBuild('/repo/packages/example');

        expect(spawnMock).toHaveBeenCalledWith('pnpm', ['build'], {
            cwd: '/repo/packages/example',
            stdio: 'inherit',
        });
    });

    it('links scaffolded packages with install under CI and dedupes locally', async () => {
        process.env.CI = 'true';
        await installDependencies('/repo', { directories: ['/repo/apps/projects/example'] });

        expect(spawnMock).toHaveBeenCalledTimes(1);
        expect(spawnMock).toHaveBeenCalledWith(
            'pnpm',
            ['install', '--no-frozen-lockfile', '--filter', '{./apps/projects/example/**}...'],
            { cwd: '/repo', stdio: ['ignore', 'ignore', 'pipe'] },
        );

        spawnMock.mockClear();
        process.env.CI = 'false';
        await installDependencies('/repo', { directories: ['/repo/apps/projects/example'] });

        expect(spawnMock).toHaveBeenCalledTimes(1);
        expect(spawnMock).toHaveBeenCalledWith('pnpm', ['dedupe'], {
            cwd: '/repo',
            stdio: ['ignore', 'ignore', 'pipe'],
        });
    });

    it('scopes CI install to the cwd package when directories are omitted', async () => {
        process.env.CI = 'true';
        await installDependencies('/repo/packages/example');

        expect(spawnMock).toHaveBeenCalledTimes(1);
        expect(spawnMock).toHaveBeenCalledWith(
            'pnpm',
            ['install', '--no-frozen-lockfile', '--filter', '{./**}...'],
            { cwd: '/repo/packages/example', stdio: ['ignore', 'ignore', 'pipe'] },
        );
    });
});
