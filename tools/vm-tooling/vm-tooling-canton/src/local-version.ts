import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as semver from 'semver';

const run = promisify(execFile);

/**
 * Parse the active Daml SDK version from the output of `dpm version`.
 *
 * The command lists every installed SDK on its own line and marks the active
 * one with a leading asterisk, for example:
 *
 *     3.4.8
 *   * 3.4.11
 *
 * The active version is the one `dpm` actually uses, so it is the only one
 * relevant for matching against the resolved version. When a single SDK is
 * listed it is the active one even without a marker.
 */
export const parseActiveSdkVersion = (output: string): string | undefined => {
    const versions = output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const active =
        versions.find((line) => line.startsWith('*')) ??
        (versions.length === 1 ? versions[0] : undefined);

    return active?.replace(/^\* /, '').trim() || undefined;
};

export const isExecutableNotFoundError = (error: unknown): boolean =>
    error instanceof Error && 'code' in error && error.code === 'ENOENT';

export const getLocalDpmVersion = async ({ cwd }: { cwd: string }): Promise<string> => {
    let output: string;

    try {
        output = (await run('dpm', ['version'], { cwd })).stdout;
    } catch (error) {
        if (isExecutableNotFoundError(error)) {
            throw new Error('dpm is not installed locally');
        }

        throw error;
    }

    const version = parseActiveSdkVersion(output);

    if (!version) {
        throw new Error('Could not determine the active Daml SDK version from `dpm version`');
    }

    return version;
};

export const parseOpenapiGeneratorVersion = (output: string): string | undefined =>
    semver.coerce(output)?.version;

export const getLocalOpenapiGeneratorVersion = async ({
    cwd,
}: {
    cwd: string;
}): Promise<string> => {
    let output: string;

    try {
        output = (await run('canton-openapi-generator', ['version'], { cwd })).stdout;
    } catch (error) {
        if (isExecutableNotFoundError(error)) {
            throw new Error('canton-openapi-generator is not installed locally');
        }

        throw error;
    }

    const version = parseOpenapiGeneratorVersion(output);

    if (!version) {
        throw new Error('Could not determine the OpenAPI generator version');
    }

    return version;
};
