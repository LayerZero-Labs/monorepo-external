import process from 'node:process';
import { $, type ProcessOutput } from 'zx';

import type { EnvironmentVariable, Tool } from '../config';

interface LocalExecutionOptions {
    cwd: string;
    args: string[];
    env: readonly EnvironmentVariable[];
    script?: string;
}

export const executeLocally = async (
    tool: Tool,
    resolvedVersion: string,
    { cwd, args, env, script }: LocalExecutionOptions,
): Promise<ProcessOutput> => {
    if (!tool.getLocalVersion) {
        throw new Error(`Local execution is not supported for ${tool.name}`);
    }

    const localVersion = await tool.getLocalVersion({ cwd });

    if (resolvedVersion !== localVersion) {
        throw new Error(
            `Local ${tool.name} version (${localVersion}) does not match the required version (${resolvedVersion})`,
        );
    }

    console.info(`🖥️  Using local ${tool.name} ${localVersion}`);

    const commandLine = script?.trim() ? ['bash', '-c', script] : [tool.name, ...args];

    const label = `⏳ ${commandLine.join(' ')}`;
    console.time(label);
    const output = await $({
        cwd,
        env: {
            ...process.env,
            ...Object.fromEntries((tool.defaultEnv ?? []).map(({ name, value }) => [name, value])),
            ...Object.fromEntries(env.map(({ name, value }) => [name, value])),
        },
    })`${commandLine}`.nothrow();
    console.timeEnd(label);

    if (output.exitCode !== 0) {
        const stdout = output.stdout.trim();

        throw new Error(
            `Failed to run local ${tool.name} (exit code: ${output.exitCode})${stdout ? `\n${stdout}` : ''}`,
        );
    }

    return output;
};
