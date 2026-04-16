/**
 * Starknet source file collector for contract verification
 *
 * Collects all Cairo source files and their dependencies from a Scarb project
 * for submission to Voyager verification API.
 */

import * as fs from 'fs/promises';
import { glob } from 'glob';
import * as path from 'path';
import * as toml from 'toml';

const SCARB_TOML_PATTERN = 'Scarb.toml';

export interface StarknetSourceSnapshot {
    sources: Record<string, string>;
    compilerVersion: string;
    packageName: string;
    projectDirPath: string;
    contractFilePath: string;
}

interface ScarbToml {
    package?: {
        name: string;
        version?: string;
    };
    workspace?: {
        members?: string[];
    };
    dependencies?: Record<string, string | { path?: string; version?: string; git?: string }>;
}

interface PackageInfo {
    name: string;
    root: string;
    manifestPath: string;
}

/**
 * Prepare contract verification artifact by collecting all source files from a Scarb project
 *
 * @param packagePath - Path to the Scarb package (containing Scarb.toml)
 * @param workspaceRoot - Path to the workspace root
 * @returns Source snapshot with all files and metadata for verification
 */
export const prepareContractVerificationArtifact = async (params: {
    packagePath: string;
    workspaceRoot: string;
}): Promise<StarknetSourceSnapshot> => {
    const { packagePath, workspaceRoot } = params;
    const absolutePath = path.resolve(packagePath);
    const manifestPath = path.join(absolutePath, SCARB_TOML_PATTERN);
    const mainPackage = await parsePackageScarbToml(manifestPath);
    const packages: PackageInfo[] = await gatherDependencies(mainPackage);

    const allSourcePaths: string[] = [];
    for (const pkg of packages) {
        const sources = await collectCairoFiles(path.join(pkg.root, 'src'));
        allSourcePaths.push(...sources);
        allSourcePaths.push(pkg.manifestPath);
    }

    const workspaceManifestPath = path.join(workspaceRoot, SCARB_TOML_PATTERN);
    if (!(await fileExists(workspaceManifestPath))) {
        throw new Error(`Workspace root Scarb.toml not found at ${workspaceManifestPath}`);
    }
    if (!allSourcePaths.includes(workspaceManifestPath)) {
        allSourcePaths.push(workspaceManifestPath);
    }

    const sources: Record<string, string> = {};
    for (const filePath of allSourcePaths) {
        const relativePath = path.relative(workspaceRoot, filePath);
        const content = await fs.readFile(filePath, 'utf-8');
        sources[relativePath] = content;
    }

    const compilerVersion = await extractCompilerVersion(manifestPath);
    // projectDirPath is always "." - Voyager builds from the root of submitted files
    const projectDirPath = '.';

    return {
        sources,
        compilerVersion,
        packageName: mainPackage.name,
        projectDirPath,
        contractFilePath: findContractFilePath(workspaceRoot, sources, mainPackage),
    };
};

/**
 * Find all packages in a Scarb workspace or single package
 * Returns a Map of packageName -> packagePath
 */
export const findScarbPackages = async (rootDir: string): Promise<Map<string, string>> => {
    const scarbTomlPath = path.join(rootDir, SCARB_TOML_PATTERN);

    let scarbToml: ScarbToml;
    try {
        scarbToml = await parseScarbToml(scarbTomlPath);
    } catch {
        throw new Error(`Scarb.toml not found at ${scarbTomlPath}, not a valid Scarb package`);
    }

    const packages = new Map<string, string>();

    if (scarbToml.workspace?.members) {
        const members = scarbToml.workspace.members;

        for (const member of members) {
            const expandedPaths = await expandMemberPattern(rootDir, member);

            for (const memberPath of expandedPaths) {
                const fullPath = path.join(rootDir, memberPath);
                const memberScarbPath = path.join(fullPath, SCARB_TOML_PATTERN);

                try {
                    const memberToml = await parseScarbToml(memberScarbPath);

                    if (memberToml.package?.name) {
                        packages.set(memberToml.package.name, fullPath);
                    }
                } catch {
                    // Not a valid package, skip
                }
            }
        }

        if (packages.size === 0) {
            throw new Error(`No packages found in workspace ${scarbTomlPath}`);
        }

        return packages;
    } else if (scarbToml.package?.name) {
        return new Map([[scarbToml.package.name, rootDir]]);
    }

    throw new Error(
        `Scarb.toml at ${scarbTomlPath} is not a valid Scarb package, must have either [workspace] or [package] section`,
    );
};

const expandMemberPattern = async (rootDir: string, pattern: string): Promise<string[]> => {
    const matches = await glob(`${pattern}/${SCARB_TOML_PATTERN}`, {
        cwd: rootDir,
        absolute: false,
    });

    return matches.map((match: string) => path.dirname(match));
};

const parsePackageScarbToml = async (manifestPath: string): Promise<PackageInfo> => {
    const parsed = await parseScarbToml(manifestPath);

    if (!parsed.package) {
        throw new Error(`${manifestPath} does not contain a [package] section`);
    }

    return {
        name: parsed.package.name,
        root: path.dirname(manifestPath),
        manifestPath,
    };
};

const parseScarbToml = async (manifestPath: string): Promise<ScarbToml> => {
    const content = await fs.readFile(manifestPath, 'utf-8');
    return toml.parse(content) as ScarbToml;
};

const gatherDependencies = async (packageInfo: PackageInfo): Promise<PackageInfo[]> => {
    const collected: PackageInfo[] = [];
    const visited: Set<string> = new Set();

    const gatherDependenciesRecursively = async (packageInfo: PackageInfo): Promise<void> => {
        if (visited.has(packageInfo.root)) {
            return;
        }
        visited.add(packageInfo.root);
        collected.push(packageInfo);
        const parsed = await parseScarbToml(packageInfo.manifestPath);

        if (!parsed.dependencies) {
            return;
        }

        for (const [_depName, depValue] of Object.entries(parsed.dependencies)) {
            // Skip non-path dependencies (registry or git)
            if (typeof depValue !== 'object' || !depValue.path) {
                continue;
            }

            const depPath = path.resolve(packageInfo.root, depValue.path);
            const depManifestPath = path.join(depPath, SCARB_TOML_PATTERN);

            if (!(await fileExists(depManifestPath))) {
                throw new Error(`Dependency not found: ${depManifestPath}`);
            }

            const depPackage = await parsePackageScarbToml(depManifestPath);
            await gatherDependenciesRecursively(depPackage);
        }
    };

    await gatherDependenciesRecursively(packageInfo);
    return collected;
};

const fileExists = async (filePath: string): Promise<boolean> => {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
};

const collectCairoFiles = async (dir: string): Promise<string[]> => {
    const collected: string[] = [];

    const collectFilesRecursively = async (currentDir: string): Promise<void> => {
        if (!(await fileExists(currentDir))) {
            throw new Error(
                `Source directory not found: ${currentDir}. All Scarb packages must have a 'src' directory containing Cairo source files.`,
            );
        }

        const entries = await fs.readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);

            if (entry.isDirectory()) {
                if (entry.name === 'test' || entry.name === 'tests') {
                    continue;
                }
                await collectFilesRecursively(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.cairo')) {
                collected.push(fullPath);
            }
        }
    };

    await collectFilesRecursively(dir);
    return collected;
};

/**
 * Extract compiler version from Scarb.toml starknet dependency
 * The starknet dependency version corresponds to the Cairo compiler version
 */
const extractCompilerVersion = async (manifestPath: string): Promise<string> => {
    const parsed = await parseScarbToml(manifestPath);

    if (parsed.dependencies?.starknet) {
        const starknetDep = parsed.dependencies.starknet;
        if (typeof starknetDep === 'string') {
            return starknetDep;
        }
        if (starknetDep.version) {
            return starknetDep.version;
        }
    }

    throw new Error(
        `Cannot determine Cairo compiler version: missing 'starknet' dependency in ${manifestPath}. ` +
            `Add a starknet dependency like: [dependencies]\nstarknet = "2.14.0"`,
    );
};

function findContractFilePath(
    workspaceRoot: string,
    sources: Record<string, string>,
    contractPackage: PackageInfo,
): string {
    const contractFilePath = path.join(
        path.relative(workspaceRoot, contractPackage.root),
        'src',
        'lib.cairo',
    );
    if (sources[contractFilePath]) {
        return contractFilePath;
    }
    throw new Error(`Contract file not found: ${contractFilePath}`);
}
