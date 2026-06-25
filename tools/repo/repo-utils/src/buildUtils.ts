import { execFile, spawn } from 'node:child_process';
import { relative, sep } from 'path';
import { promisify } from 'util';

const execFilePromise = promisify(execFile);

export type RunCodeFormattersOptions = {
    directoriesToLint?: string[];
    skipFormatting?: boolean;
    skipLint?: boolean;
    verbose?: boolean;
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
 * @param options.verbose - When true, echo formatter stderr and log errors before rethrowing.
 *   Failures always throw regardless of this flag.
 */
export const runCodeFormatters = async (
    filepath: string,
    packagePath: string,
    {
        directoriesToLint,
        skipFormatting = false,
        skipLint = false,
        verbose = false,
    }: RunCodeFormattersOptions = {},
): Promise<void> => {
    if (skipFormatting && skipLint) {
        return;
    }

    try {
        if (!skipFormatting) {
            const stderr = await new Promise<string>((resolve, reject) => {
                const child = spawn('pnpm', ['prettier', '--write', filepath], {
                    cwd: packagePath,
                    stdio: ['ignore', 'ignore', 'pipe'],
                });
                let stderr = '';
                child.stderr.on('data', (chunk) => (stderr += chunk));
                child.on('error', reject);
                child.on('close', (code) =>
                    code === 0
                        ? resolve(stderr)
                        : reject(new Error(`prettier exited with code ${code}`)),
                );
            });
            if (stderr && verbose) {
                console.error('Error running prettier:', stderr);
            }
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
                await execFilePromise(
                    'pnpm',
                    [
                        ...filters,
                        'run',
                        ...(isMultiPackage ? ['--no-bail'] : []),
                        '--if-present',
                        'lint',
                    ],
                    { cwd: packagePath },
                );
            } catch {
                // Lint scripts conventionally exit non-zero after applying auto-fixes; the
                // retry verifies whether the file is actually clean now or a real failure
                // remains.
                await execFilePromise('pnpm', [...filters, 'run', '--if-present', 'lint'], {
                    cwd: packagePath,
                });
            }
        }
    } catch (error) {
        if (verbose) {
            console.error('Error formatting file:', error);
        }
        throw error;
    }
};

/**
 * Installs dependencies using pnpm in the specified package directory.
 * @param packagePath - The path to the package directory.
 */
export const installDependencies = async (packagePath: string): Promise<void> => {
    try {
        console.log(`\n🔧 Deduping dependencies...`);
        await execFilePromise('pnpm', ['dedupe'], { cwd: packagePath });
        console.log(`\n🔧 Installing dependencies...`);
        await execFilePromise('pnpm', ['install'], { cwd: packagePath });
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
        await execFilePromise('pnpm', ['-w', 'config:check', '--fix'], { cwd: packagePath });
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

    return new Promise((resolve, reject) => {
        const buildProcess = spawn('pnpm', ['build'], {
            cwd: packagePath,
            stdio: 'inherit', // Stream output directly
        });

        buildProcess.on('close', (code) => {
            if (code === 0) {
                console.log(`✅ Build completed successfully`);
                resolve();
            } else {
                console.error(`❌ Build failed with exit code ${code}`);
                console.log(`💡 You can manually run 'pnpm build' in the package directory`);
                reject(new Error(`Build failed with exit code ${code}`));
            }
        });

        buildProcess.on('error', (error) => {
            console.error(`❌ Failed to run build:`, error.message);
            console.log(`💡 You can manually run 'pnpm build' in the package directory`);
            reject(error);
        });
    });
};

export const generateContractsSnapshot = async (repoDirectory: string): Promise<void> => {
    console.log(`\n🔧 Generating contracts snapshot...`);
    try {
        await execFilePromise('pnpm', ['turbo:run', 'test:snapshot:update', '--continue'], {
            cwd: repoDirectory,
        });
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
