import { describe, expect, it } from 'vitest';

import { execFile } from '../src';

describe(execFile, () => {
    it('resolves with standard output', async () => {
        await expect(execFile('node', ['-e', 'process.stdout.write("hello")'])).resolves.toEqual(
            'hello',
        );
    });

    it('resolves with an empty string when standard output is inherited', async () => {
        await expect(execFile('node', ['-e', ''], { stdio: 'inherit' })).resolves.toEqual('');
    });

    it('passes options through to the child process', async () => {
        await expect(
            execFile('node', ['-e', 'process.stdout.write(process.env.GREETING ?? "")'], {
                env: { ...process.env, GREETING: 'hi' },
            }),
        ).resolves.toEqual('hi');
    });

    it('rejects on a non-zero exit code', async () => {
        await expect(execFile('node', ['-e', 'process.exit(42)'])).rejects.toThrow('exit code 42');
    });

    it('rejects when the process is killed by a signal', async () => {
        await expect(
            execFile('node', ['-e', 'process.kill(process.pid, "SIGKILL")']),
        ).rejects.toThrow('signal SIGKILL');
    });

    it('rejects when the executable is not found', async () => {
        await expect(execFile('executable-that-does-not-exist')).rejects.toThrow(/ENOENT/);
    });
});
