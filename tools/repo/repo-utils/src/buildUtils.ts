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
    // Same-directory scope leaves an empty relative path. Keep it `./**`, not `.//**`
    return relativePath ? `./${relativePath}/**` : './**';
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

export type InstallDependenciesOptions = {
    /**
     * Dedupe the lockfile. Off under CI so generator CI does not re-resolve the workspace
     */
    dedupe?: boolean;
    /**
     * Limit install to workspace packages under these paths. Defaults to `packagePath` under CI
     */
    directories?: string[];
};

/**
 * Links packages created after the caller's initial install.
 * Under CI this is a scoped `pnpm install --no-frozen-lockfile`
 *
 * @param packagePath - The path to the package directory.
 * @param options - Optional install configuration.
 * @param options.dedupe - Dedupe the lockfile. Defaults to `false` under CI.
 * @param options.directories - Scope the install to packages under these package-directory paths.
 */
export const installDependencies = async (
    packagePath: string,
    { dedupe = process.env.CI !== 'true', directories }: InstallDependenciesOptions = {},
): Promise<void> => {
    console.log(`\n🔧 Installing dependencies...`);
    if (dedupe) {
        await runPnpm(['dedupe'], packagePath, false);
    } else {
        // Always scope. An empty filter set would reinstall the whole workspace under CI
        const scopeDirectories = directories?.length ? directories : [packagePath];
        const filters = scopeDirectories.flatMap((directory) => [
            '--filter',
            // Braces scope the directory glob. The suffix includes workspace dependencies
            `{${toPnpmFilterPath(directory, packagePath)}}...`,
        ]);
        // pnpm freezes the lockfile when CI=true. Scaffolding adds importers not in the committed lockfile yet
        await runPnpm(['install', '--no-frozen-lockfile', ...filters], packagePath, false);
    }
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

export type RunBuildOptions = {
    /**
     * Limit the build to these workspace packages plus their dependencies
     */
    directories?: string[];
};

/**
 * Runs the build for the given package path.
 *
 * @param packagePath - The path to the package directory.
 * @param options - Optional build configuration.
 * @param options.directories - Package-directory paths used to form scoped `--filter` globs.
 */
export const runBuild = async (
    packagePath: string,
    { directories }: RunBuildOptions = {},
): Promise<void> => {
    console.log(`\n🔧 Running build...`);
    const filters =
        directories?.flatMap((directory) => [
            '--filter',
            // Braces scope the directory glob. The suffix includes workspace dependencies
            `{${toPnpmFilterPath(directory, packagePath)}}...`,
        ]) ?? [];
    // Call turbo:run directly when scoping. `pnpm build -- --filter` forwards a literal `--` into turbo
    const args = filters.length > 0 ? ['turbo:run', 'build', ...filters] : ['build'];
    try {
        // Verbosely log stdout so that we can inspect cache misses.
        await runPnpm(args, packagePath, true);
        console.log(`✅ Build completed successfully`);
    } catch (error) {
        console.error(`❌ Build failed:`, error instanceof Error ? error.message : error);
        console.log(`💡 You can manually run 'pnpm ${args.join(' ')}' from ${packagePath}`);
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
        // Verbose so turbo-run.sh failure details are not discarded
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
