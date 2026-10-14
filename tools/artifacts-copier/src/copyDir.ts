import * as fs from 'node:fs';
import * as path from 'node:path';

import type { DirectoryConfig } from './types';

export const copyDir = async (
    resolvePath: (relativePathWithinPackage: string) => string,
    rootPath: string,
    pkgName: string,
    directory: DirectoryConfig,
) => {
    // Resolve the package root
    const contractPkgRoot = path.dirname(resolvePath(`${pkgName}/package.json`));

    const { name, rename } = directory;

    // Setup paths
    const artifactSourcePath = path.join(contractPkgRoot, name);
    const artifactDestPath = path.join(rootPath, rename || name);

    // Create destination parent directory with proper permissions
    await fs.promises.mkdir(path.dirname(artifactDestPath), { recursive: true, mode: 0o755 });

    // Copy the directory
    await fs.promises.cp(artifactSourcePath, artifactDestPath, {
        recursive: true,
        force: true,
    });

    console.log(`Copied dir: ${artifactSourcePath} -> ${artifactDestPath}`);
};
