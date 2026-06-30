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
    directoriesToLint?: string[];
    skipFormatting?: boolean;
    skipLint?: boolean;
};

const toPnpmFilterPath = (absolutePath: string, fromPath: string): string => {
    const relativePath = relative(fromPath, absolutePath).split(sep).join('/');

    // `./path/**` matches every workspace package located under `./path/`.
    return `./${relativePath}/**`;
};

/**
 * Runs prettier on `filepath` and lint on the relevant package(s).
 *
 * @param filepath - The file or directory path to run prettier against.
 * @param packagePath - The package root used as the working directory for formatter commands.
 * @param options - Optional formatter configuration.
 * @param options.directoriesToLint - When provided, lint runs against every workspace package
 *   located under these directories. When omitted, lint runs only against the package at `packagePath`.
 * @param options.skipFormatting - Skip prettier when true.
 * @param options.skipLint - Skip package lint commands when true.
 */
export const runCodeFormatters = async (
    filepath: string,
    packagePath: string,
    { directoriesToLint, skipFormatting = false, skipLint = false }: RunCodeFormattersOptions = {},
): Promise<void> => {
    if (skipFormatting && skipLint) {
        return;
    }

    if (!skipFormatting) {
        await runPnpm(['prettier', '--write', filepath], packagePath, false);
    }

    if (!skipLint) {
        const filters =
            directoriesToLint?.flatMap((directory) => [
                '--filter',
                toPnpmFilterPath(directory, packagePath),
            ]) ?? [];
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
    try {
        console.log(`\n🔧 Deduping dependencies...`);
        await runPnpm(['dedupe'], packagePath, false);
        console.log(`\n🔧 Installing dependencies...`);
        await runPnpm(['install'], packagePath, false);
        console.log(`✅ Dependencies installed successfully`);
    } catch (error) {
        console.error(
            `❌ Failed to install dependencies:`,
            error instanceof Error ? error.message : error,
        );
        console.log(`💡 You can manually run 'pnpm install'`);
    }
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

export const generateContractsSnapshot = async (repoDirectory: string): Promise<void> => {
    console.log(`\n🔧 Generating contracts snapshot...`);
    try {
        await runPnpm(['turbo:run', 'test:snapshot:update', '--continue'], repoDirectory, false);
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
