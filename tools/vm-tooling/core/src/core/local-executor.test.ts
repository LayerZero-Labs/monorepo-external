import process from 'node:process';
import { describe, expect, it } from 'vitest';

import type { Tool } from '../config';
import { executeLocally } from './local-executor';

describe(executeLocally, () => {
    const cwd = process.cwd();

    it('throws when the tool does not support local execution', async () => {
        const tool: Tool = { name: 'forge' };

        await expect(
            executeLocally(tool, '1.0.0', { cwd, args: [], env: [] }),
        ).rejects.toThrowError(/not supported/);
    });

    it('throws when the local version does not match', async () => {
        const tool: Tool = { name: 'forge', getLocalVersion: async () => '1.0.0' };

        await expect(
            executeLocally(tool, '2.0.0', { cwd, args: [], env: [] }),
        ).rejects.toThrowError(/does not match the required version/);
    });

    it('propagates the error raised while probing the local version', async () => {
        const tool: Tool = {
            name: 'forge',
            getLocalVersion: async () => {
                throw new Error('forge is not installed locally');
            },
        };

        await expect(
            executeLocally(tool, '1.0.0', { cwd, args: [], env: [] }),
        ).rejects.toThrowError(/not installed locally/);
    });

    it('runs the host tool when the version matches', async () => {
        const tool: Tool = { name: 'node', getLocalVersion: async () => '1.0.0' };

        const output = await executeLocally(tool, '1.0.0', {
            cwd,
            args: ['-e', 'process.stdout.write("ran")'],
            env: [],
        });

        expect(output.exitCode).toBe(0);
        expect(output.stdout).toContain('ran');
    });

    it('passes custom environment variables to the host tool', async () => {
        const tool: Tool = { name: 'node', getLocalVersion: async () => '1.0.0' };

        const output = await executeLocally(tool, '1.0.0', {
            cwd,
            args: ['-e', 'process.stdout.write(process.env.LZ_LOCAL_TEST ?? "")'],
            env: [{ name: 'LZ_LOCAL_TEST', value: 'present' }],
        });

        expect(output.stdout).toContain('present');
    });

    it('runs a custom script via bash without prefixing the tool name', async () => {
        const tool: Tool = { name: 'node', getLocalVersion: async () => '1.0.0' };

        const output = await executeLocally(tool, '1.0.0', {
            cwd,
            args: [],
            env: [],
            script: 'printf scripted',
        });

        expect(output.exitCode).toBe(0);
        expect(output.stdout).toContain('scripted');
    });

    it('throws when the host tool exits with a non-zero code', async () => {
        const tool: Tool = { name: 'node', getLocalVersion: async () => '1.0.0' };

        await expect(
            executeLocally(tool, '1.0.0', {
                cwd,
                args: ['-e', 'process.exit(2)'],
                env: [],
            }),
        ).rejects.toThrowError(/exit code: 2/);
    });
});
