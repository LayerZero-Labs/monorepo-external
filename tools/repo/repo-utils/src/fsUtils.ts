import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, resolve } from 'path';
import url from 'url';

export const getPackagePath = (
    targetPath: string,
    packageName: string,
    originalCwd?: string,
): string => {
    const basePath = originalCwd || findProjectDir();
    const resolvedTargetPath = resolve(basePath, targetPath);
    return join(resolvedTargetPath, packageName);
};

/**
 * Checks if a package directory already exists.
 * @param packagePath - The path to the package directory.
 */
export const checkIfAlreadyExists = async (packagePath: string): Promise<boolean> => {
    // Check if package directory already exists
    try {
        await fs.access(packagePath);
        return true;
    } catch {
        return false;
    }
};

/**
 * Finds the start directory
 * @returns The absolute path to the start directory
 */
export const findProjectDir = (internal?: boolean): string => {
    if (internal) {
        return execSync('pnpm -w exec pwd').toString().trim();
    }

    return process.cwd();
};

/**
 * Resolves a path relative to the project directory
 */
export const resolvePathWithProjectDir = (targetPath: string, internal: boolean = true) => {
    if (isAbsolute(targetPath)) {
        return targetPath;
    }
    return resolve(findProjectDir(internal), targetPath);
};

/**
 * Resolve an installed package's root directory from its npm name.
 *
 * Anchored at the cwd rather than this module so resolution walks the consuming package's
 * node_modules, letting a build step reach a dependency's files without hardcoding relative
 * paths.
 */
export const resolvePackageDir = (packageName: string): string => {
    const req = createRequire(join(process.cwd(), 'package.json'));

    try {
        return dirname(req.resolve(`${packageName}/package.json`));
    } catch (cause) {
        throw new Error(
            `Cannot resolve package "${packageName}" from ${process.cwd()}. Add it as a ` +
                'dependency of the package running this command, and make sure it either omits ' +
                'an "exports" map or exposes "./package.json" within it.',
            { cause },
        );
    }
};

export const writeFile = async (path: string, content: string) => {
    return await fs.writeFile(path, content, 'utf-8');
};

export const readFile = async (path: string) => {
    return await fs.readFile(path, 'utf-8');
};

export const mkdir = async (path: string) => {
    await fs.mkdir(path, { recursive: true });
};

export const rm = async (path: string) => {
    await fs.rm(path, { recursive: true, force: true });
};

export const access = async (path: string) => {
    await fs.access(path);
};

export const readDir = async (sourcePath: string) => {
    return fs.readdir(sourcePath, { withFileTypes: true });
};

export const copyFile = async (sourcePath: string, destinationPath: string) => {
    await fs.copyFile(sourcePath, destinationPath);
};

export const buildTree = async (dirPath: string, prefix = ''): Promise<string> => {
    const entries = (await readDir(dirPath))
        .sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return 1;
            if (!a.isDirectory() && b.isDirectory()) return -1;
            return a.name.localeCompare(b.name);
        })
        .filter(
            (entry) =>
                entry.name !== 'dist' &&
                entry.name !== 'node_modules' &&
                entry.name !== 'tsconfig.tsbuildinfo',
        );

    const parts = await Promise.all(
        entries.map(async (entry, index) => {
            const isLast = index === entries.length - 1;
            const branch = isLast ? '└── ' : '├── ';

            let line = prefix + branch + entry.name;
            const childPath = join(dirPath, entry.name);
            if (entry.isDirectory()) {
                const extension = isLast ? '    ' : '│   ';
                line += '\n' + (await buildTree(childPath, prefix + extension));
            }
            return line;
        }),
    );

    return parts.join('\n');
};

export const logPackageStructure = async (packagePath: string): Promise<void> => {
    const tree = await buildTree(packagePath);
    console.log(`📦 Created package structure at: ${packagePath}`);
    console.log(tree);
};

export const getModulePath = (callerUrl: string, subPaths: string[]): string => {
    let currentPath = url.fileURLToPath(callerUrl);
    while (dirname(currentPath) !== currentPath) {
        const dirName = basename(currentPath);
        if (dirName === 'src' || dirName === 'dist') {
            return join(currentPath, ...subPaths);
        }
        currentPath = dirname(currentPath);
    }

    throw new Error('Could not find module: ' + callerUrl);
};
