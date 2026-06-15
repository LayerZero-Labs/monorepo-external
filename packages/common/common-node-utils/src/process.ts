import { spawn, type SpawnOptions } from 'node:child_process';

/**
 * The asynchronous version of `execFileSync` with the `stdio` option available
 * (e.g. `inherit` to stream output of long-running commands live), which the
 * promisified `execFile` does not support.
 * @returns The standard output decoded as UTF-8, or an empty string if it is not piped
 */
export const execFile = (
    file: string,
    args: readonly string[] = [],
    options: SpawnOptions = {},
): Promise<string> => {
    const { resolve, reject, promise } = Promise.withResolvers<string>();

    const child = spawn(file, args, options);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));

    child.on('error', reject);
    child.on('close', (code: number | null, signal: string | null) => {
        if (code === 0) {
            resolve(Buffer.concat(stdout).toString('utf-8'));
            return;
        }

        reject(
            new Error(
                `Command failed with ${signal ? `signal ${signal}` : `exit code ${code}`}: ${[file, ...args].join(' ')}`,
                { cause: { stderr: Buffer.concat(stderr).toString('utf-8') } },
            ),
        );
    });

    return promise;
};
