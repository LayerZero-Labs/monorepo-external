import { execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { join } from 'path';
import { promisify } from 'util';

const execFilePromise = promisify(execFile);

export type RunCodeFormattersOptions = {
    skipFormatting?: boolean;
    skipLint?: boolean;
    silent?: boolean;
    detached?: boolean;
};

/**
 * Gets the package name from package.json
 */
const getPackageName = async (packagePath: string): Promise<string> => {
    const packageJsonPath = join(packagePath, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
    return packageJson.name;
};

/**
 * Builds formatter commands based on options
 */
const buildFormatterCommands = async (
    filepath: string,
    packagePath: string,
    skipFormatting: boolean,
    skipLint: boolean,
): Promise<string[]> => {
    const commands: string[] = [];

    if (!skipFormatting) {
        commands.push(`pnpm -w prettier --write "${filepath}"`);
    }

    if (!skipLint) {
        const packageName = await getPackageName(packagePath);
        commands.push(`pnpm --filter="${packageName}" lint`);
    }

    return commands;
};

/**
 * Runs formatters in detached mode
 */
const runDetachedFormatters = (
    shellCommand: string,
    packagePath: string,
    silent: boolean,
): void => {
    const child = spawn('sh', ['-c', shellCommand], {
        detached: true,
        stdio: silent ? 'ignore' : ['ignore', 'pipe', 'pipe'],
        cwd: packagePath,
    });

    // Unref the child so the parent can exit independently
    child.unref();

    if (!silent) {
        child.stdout?.on('data', (data) => {
            console.log(`[Formatter]: ${data.toString().trim()}`);
        });
        child.stderr?.on('data', (data) => {
            console.error(`[Formatter Error]: ${data.toString().trim()}`);
        });
    }
};

/**
 * Runs formatters synchronously
 */
const runSyncFormatters = async (
    filepath: string,
    packagePath: string,
    skipFormatting: boolean,
    skipLint: boolean,
    silent: boolean,
): Promise<void> => {
    if (!skipFormatting) {
        const { stderr: prettierStderr } = await execFilePromise(
            'pnpm',
            ['prettier', '--write', filepath],
            { cwd: packagePath },
        );
        if (prettierStderr && !silent) {
            console.error('Error running prettier:', prettierStderr);
        }
    }

    if (!skipLint) {
        const packageName = await getPackageName(packagePath);
        const { stderr: lintStderr } = await execFilePromise('pnpm', [
            '--filter=' + packageName,
            'lint',
        ]);

        if (lintStderr && !silent) {
            console.error('Error running lint:fix:', lintStderr);
        }
    }
};

/**
 * Runs the code formatters for the given filepath in the given package path.
 * @param filepath - The path to the file to format.
 * @param packagePath - The path to the package directory.
 * @param options {RunCodeFormattersOptions} - The options for running the code formatters.
 */
export const runCodeFormatters = async (
    filepath: string,
    packagePath: string,
    {
        skipFormatting = false,
        skipLint = false,
        silent = false,
        detached = false,
    }: RunCodeFormattersOptions = {},
) => {
    try {
        if (skipFormatting && skipLint) {
            return;
        }

        if (detached) {
            const commands = await buildFormatterCommands(
                filepath,
                packagePath,
                skipFormatting,
                skipLint,
            );
            if (commands.length === 0) {
                return;
            }

            const shellCommand = commands.join(' & ');
            runDetachedFormatters(shellCommand, packagePath, silent);
        } else {
            await runSyncFormatters(filepath, packagePath, skipFormatting, skipLint, silent);
        }
    } catch (error) {
        if (silent) {
            return;
        }

        console.error('Error formatting file:', error);
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
