import { spawn } from 'node:child_process';
import { relative, sep } from 'path';

const runPnpm = (args: string[], cwd: string, verbose: boolean): Promise<void> =>
    new Promise((resolve, reject) => {
        // Use `spawn` instead of `execFile` so stdout is never buffered into memory: a repo-wide
        // lint pass prints a line per file and would exceed execFile's default 1 MiB `maxBuffer`.
        const child = spawn('pnpm', args, {
            cwd,
            // When `verbose`, stream everything live (`inherit`). Otherwise, discard stdout but
            // capture and append stderr to the error message.
            stdio: verbose ? 'inherit' : ['ignore', 'ignore', 'pipe'],
        });
        let stderr = '';
        child.stderr?.on('data', (chunk) => (stderr += chunk));
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            const detail = stderr.trim();
            reject(
                new Error(
                    `pnpm ${args.join(' ')} exited with code ${code}${detail ? `\n${detail}` : ''}`,
                ),
            );
        });
    });

export type RunCodeFormattersOptions = {
    skipFormatting?: boolean;
    skipLint?: boolean;
};

const toPnpmFilterPath = (absolutePath: string, fromPath: string): string => {
    const relativePath = relative(fromPath, absolutePath).split(sep).join('/');

    // `./path/**` matches every workspace package located under `./path/`.
    return `./${relativePath}/**`;
};

/**
 * Runs prettier and lint scoped to `paths`.
 *
 * @param paths - File or directory paths to format and lint.
 * @param packagePath - Working directory for formatter commands (workspace root or package root).
 * @param options - Optional formatter configuration.
 * @param options.skipFormatting - Skip prettier when true.
 * @param options.skipLint - Skip package lint commands when true.
 */
export const runCodeFormatters = async (
    paths: string[],
    packagePath: string,
    { skipFormatting = false, skipLint = false }: RunCodeFormattersOptions = {},
): Promise<void> => {
    if (skipFormatting && skipLint) {
        return;
    }

    if (!skipFormatting) {
        await runPnpm(
            ['prettier', '--write', '--cache', '--experimental-cli', ...paths],
            packagePath,
            false,
        );
    }

    if (!skipLint) {
        const filters = paths.flatMap((directory) => {
            const relativePath = relative(packagePath, directory).split(sep).join('/');
            if (!relativePath || relativePath === '.') {
                return [];
            }
            return ['--filter', toPnpmFilterPath(directory, packagePath)];
        });
        const isMultiPackage = filters.length > 0;

        try {
            // --no-bail is a recursive-only flag: in multi-package mode it lets every
            // matched package take its auto-fix pass instead of bailing at the first
            // failure. Passing it to a single-package run triggers a pnpm bug that
            // swallows the script's exit code (pnpm/pnpm#8013)
            await runPnpm(
                [
                    ...filters,
                    'run',
                    ...(isMultiPackage ? ['--no-bail'] : []),
                    '--if-present',
                    'lint',
                ],
                packagePath,
                false,
            );
        } catch {
            // Lint scripts conventionally exit non-zero after applying auto-fixes; the
            // retry verifies whether the file is actually clean now or a real failure
            // remains.
            await runPnpm([...filters, 'run', '--if-present', 'lint'], packagePath, false);
        }
    }
};

/**
 * Installs dependencies using pnpm in the specified package directory.
 * @param packagePath - The path to the package directory.
 */
export const installDependencies = async (packagePath: string): Promise<void> => {
    console.log(`\n🔧 Installing dependencies...`);
    await runPnpm(['dedupe'], packagePath, false);
    console.log(`✅ Dependencies installed successfully`);
};

/**
 * Runs the config checker for the given package path (at the root of the workspace).
 */
export const runConfigChecker = async (packagePath: string): Promise<void> => {
    console.log(`\n🔧 Running config checker...`);
    try {
        // Run config checker from the workspace root hence we are using the -w flag
        await runPnpm(['-w', 'config:check', '--fix'], packagePath, false);
        console.log(`✅ Config checker completed successfully`);
    } catch (error) {
        console.error(
            `❌ Failed to run config checker:`,
            error instanceof Error ? error.message : error,
        );
        console.log(`💡 You can manually run 'pnpm -w config:check --fix'`);
    }
};

/**
 * Runs the build for the given package path.
 *
 * @param packagePath - The path to the package directory.
 */
export const runBuild = async (packagePath: string): Promise<void> => {
    console.log(`\n🔧 Running build...`);
    try {
        // Verbosely log stdout so that we can inspect cache misses.
        await runPnpm(['build'], packagePath, true);
        console.log(`✅ Build completed successfully`);
    } catch (error) {
        console.error(`❌ Build failed:`, error instanceof Error ? error.message : error);
        console.log(`💡 You can manually run 'pnpm build' in the package directory`);
        throw error;
    }
};

export type GenerateContractsSnapshotOptions = {
    /**
     * Limit snapshot update to workspace packages under these directories. When omitted, turbo
     * updates every package with `test:snapshot:update` — which is what made generator-build
     * flake on unrelated packages (e.g. `contracts/protocol/sui/contracts`).
     */
    directories?: string[];
};

export const generateContractsSnapshot = async (
    repoDirectory: string,
    { directories }: GenerateContractsSnapshotOptions = {},
): Promise<void> => {
    console.log(`\n🔧 Generating contracts snapshot...`);
    const filters =
        directories?.flatMap((directory) => [
            '--filter',
            toPnpmFilterPath(directory, repoDirectory),
        ]) ?? [];
    try {
        // Verbose (inherit): `turbo-run.sh` merges task failure details onto stdout (`2>&1 | tee`).
        // Non-verbose mode discards stdout, so snapshot failures collapsed to "exited with code 1".
        // Same pattern as `runBuild` above.
        await runPnpm(
            ['turbo:run', 'test:snapshot:update', '--continue', ...filters],
            repoDirectory,
            true,
        );
        console.log(`✅ Contracts snapshot generated successfully`);
    } catch (error) {
        console.error(
            `❌ Failed to generate contracts snapshot:`,
            error instanceof Error ? error.message : error,
        );
        console.log(
            `💡 You can manually run 'pnpm turbo:run test:snapshot:update --continue' in the repository directory`,
        );
        throw error;
    }
};
