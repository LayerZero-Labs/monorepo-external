import depcheck from 'depcheck';
import { promises as fs } from 'fs';
import pLimit from 'p-limit';
import path from 'path';

import { catalogize } from './catalog';
import { safeRegexMatch } from './safeRegex';
import type { Catalog, PackageJson, PnpmPackageObject } from './types';
import { execPromise, getCachedCatalog, getCatalog, getPnpmLs } from './utils';

const CONCURRENCY_LIMIT = 20;

/**
 * Default pattern for dependencies that should be moved to devDependencies
 * // DO NOT CHANGE WITHOUT UPDATING USAGE IN validateCmd AND depsCmd
 */
export const MOVE_TO_DEV_DEFAULT_PATTERN = [
    '@layerzerolabs/artifacts-copier',
    '@layerzerolabs/evm-abi-generator',
    '@layerzerolabs/evm-ts-artifacts-generator',
    '@layerzerolabs/tsup-configuration',
    '@types',
    'eslint',
    'prettier',
    'tsup',
    'vitest',
].join(',');

// Cache npm view results within a single run to avoid repeated network calls
const versionCache = new Map<string, string | null>();
const versionLimit = pLimit(5);

export const validateCatalog = async (only?: string) => {
    const { pnpmLs, pnpmLsObject } = await getPnpmLs();
    const packages = pnpmLs.map((p) => p.name).filter((x) => x !== 'root');
    const targets = only
        ? packages.filter((n) => n === only || safeRegexMatch({ str: n, pattern: only }))
        : packages;

    const catalog = await getCatalog();

    // Limit concurrency for catalog validation
    const limit = pLimit(CONCURRENCY_LIMIT);
    const results = await Promise.all(
        targets.map((packageName) =>
            limit(() => catalogize(pnpmLsObject[packageName], catalog, [])),
        ),
    );

    const throwError = results.some((r) => r.throwError);
    const changed = results.some((r) => r.changed);

    if (throwError || changed) {
        throw new Error('catalogize failed, run `pnpm fixdeps` to fix');
    }
};

export const updateDeps = async (params: {
    packages: string[];
    pnpmLsObject: { [key: string]: PnpmPackageObject };
    only?: string;
    ignore?: string;
    regex?: boolean;
    ignorePatterns?: string[];
    customCatalog?: Catalog;
}): Promise<{ [key: string]: PackageJson }> => {
    let { packages, pnpmLsObject, only, ignore, regex, ignorePatterns, customCatalog } = params;

    // Filter packages using the unified filtering function
    packages = filterPackages({ packages, only, ignore, regex });

    const packageResult: { [key: string]: PackageJson } = {};

    let allDeps: { [key: string]: Set<string> } = {};

    allDeps = await processDependencies(packages, pnpmLsObject);

    logInconsistentDependencies(allDeps);

    // Limit concurrency to prevent resource exhaustion
    const limit = pLimit(CONCURRENCY_LIMIT);
    const workspacePackages = new Set(Object.keys(pnpmLsObject));
    const results = await Promise.all(
        packages.map((p) =>
            limit(() =>
                processPackageDependencies({
                    packageName: p,
                    allDeps,
                    packageInfo: pnpmLsObject[p],
                    workspacePackages,
                    ignorePatterns,
                    customCatalog,
                }),
            ),
        ),
    );

    results.forEach((result) => {
        if (result) {
            const [packageJsonPath, packageJson] = result;
            packageResult[packageJsonPath] = packageJson;
        }
    });

    return packageResult;
};

export const processDependencies = async (
    packages: string[],
    pnpmLsObject: { [key: string]: PnpmPackageObject },
): Promise<{ [key: string]: Set<string> }> => {
    const allDeps: { [key: string]: Set<string> } = {};

    // Limit concurrency to prevent file system bottleneck
    const limit = pLimit(CONCURRENCY_LIMIT * 3);
    await Promise.all(
        packages.map((p) =>
            limit(async () => {
                if (p.includes('truesight')) {
                    return;
                }

                const packageInfo = pnpmLsObject[p];
                if (!packageInfo) {
                    throw new Error(`Package ${p} not found in pnpmLsObject`);
                }

                const packageJsonPath = path.join(packageInfo.path, 'package.json');

                let packageJson: PackageJson;
                try {
                    const fileContent = await fs.readFile(packageJsonPath, 'utf-8');
                    packageJson = JSON.parse(fileContent) as PackageJson;
                } catch (error) {
                    throw new Error(
                        `Failed to read package.json for ${p} at ${packageJsonPath}: ${
                            error instanceof Error ? error.message : String(error)
                        }`,
                    );
                }

                Object.keys(packageJson.dependencies || {}).forEach((dep: string) => {
                    if (!allDeps[dep]) {
                        allDeps[dep] = new Set();
                    }
                    allDeps[dep].add(packageJson.dependencies![dep]);
                });
            }),
        ),
    );

    return allDeps;
};

export const moveToDev = async (params: {
    packages: string[];
    packageResult: { [key: string]: PackageJson };
    pattern: string;
    pnpmLsObject: { [key: string]: PnpmPackageObject };
    only?: string;
    ignore?: string;
    regex?: boolean;
}) => {
    let { packages } = params;
    const { packageResult, pattern, pnpmLsObject, only, ignore, regex } = params;
    packages = filterPackages({ packages, only, ignore, regex });
    let patterns = pattern.split(',');
    // Limit concurrency to prevent file system bottleneck
    const limit = pLimit(CONCURRENCY_LIMIT * 3);
    await Promise.all(
        packages.map((packageName) =>
            limit(async () => {
                let found = false;
                let log = '';

                const packageInfo = pnpmLsObject[packageName];
                if (!packageInfo) {
                    throw new Error(`Package ${packageName} not found in pnpmLsObject`);
                }

                const packageJsonPath = path.join(packageInfo.path, 'package.json');
                let packageJson = packageResult[packageJsonPath];

                if (!packageJson) {
                    try {
                        const fileContent = await fs.readFile(packageJsonPath, 'utf-8');
                        packageJson = JSON.parse(fileContent) as PackageJson;
                    } catch (error) {
                        throw new Error(
                            `Failed to read package.json for ${packageName} at ${packageJsonPath}: ${
                                error instanceof Error ? error.message : String(error)
                            }`,
                        );
                    }
                }

                Object.keys(packageJson.dependencies || {}).forEach((dep: string) => {
                    if (
                        patterns.some((pattern: string) =>
                            safeRegexMatch({ str: dep, pattern, useRegex: regex ?? true }),
                        )
                    ) {
                        if (!found) {
                            log += `-----------------${packageName}-----------------------\n`;
                            found = true;
                        }
                        packageJson.devDependencies ??= {};
                        log += `Moving ${dep} to dev dependencies\n`;
                        packageJson.devDependencies[dep] = packageJson.dependencies![dep];
                        delete packageJson.dependencies![dep];
                    }
                });

                if (found) {
                    packageResult[packageJsonPath] = packageJson;
                    console.log(log);
                }
            }),
        ),
    );
};

export const removeDuplicates = async (params: {
    packages: string[];
    packageResult: { [key: string]: PackageJson };
    pattern: string;
    pnpmLsObject: { [key: string]: PnpmPackageObject };
    only?: string;
    ignore?: string;
    regex?: boolean;
    write?: boolean;
}) => {
    let { packages } = params;
    const { packageResult, pattern, pnpmLsObject, only, ignore, regex, write } = params;
    packages = filterPackages({ packages, only, ignore, regex });
    let patterns = pattern.split(',');
    // Limit concurrency to prevent file system bottleneck
    const limit = pLimit(CONCURRENCY_LIMIT * 3);
    await Promise.all(
        packages.map((packageName) =>
            limit(async () => {
                let found = false;
                let log = '';

                const packageInfo = pnpmLsObject[packageName];
                if (!packageInfo) {
                    throw new Error(`Package ${packageName} not found in pnpmLsObject`);
                }

                const packageJsonPath = path.join(packageInfo.path, 'package.json');
                let packageJson = packageResult[packageJsonPath];

                if (!packageJson) {
                    try {
                        const fileContent = await fs.readFile(packageJsonPath, 'utf-8');
                        packageJson = JSON.parse(fileContent) as PackageJson;
                    } catch (error) {
                        throw new Error(
                            `Failed to read package.json for ${packageName} at ${packageJsonPath}: ${
                                error instanceof Error ? error.message : String(error)
                            }`,
                        );
                    }
                }

                const deps = packageJson.dependencies || {};
                const devDeps = packageJson.devDependencies || {};
                const duplicates = Object.keys(deps).filter((dep) => devDeps[dep]);

                if (duplicates.length > 0) {
                    if (!found) {
                        log += `-----------------${packageName}-----------------------\n`;
                        found = true;
                    }

                    // When write is false, create a copy to avoid mutating the original for validation
                    // When write is true, modify the object directly (it's already in packageResult or will be added)
                    let targetPackageJson = packageJson;
                    if (!write) {
                        targetPackageJson = JSON.parse(JSON.stringify(packageJson)) as PackageJson;
                    }

                    for (const dep of duplicates) {
                        const shouldBeInDevDeps = patterns.some((pattern: string) =>
                            safeRegexMatch({ str: dep, pattern, useRegex: regex ?? true }),
                        );

                        if (shouldBeInDevDeps) {
                            log += `Removing duplicate ${dep} from dependencies (keeping in devDependencies)\n`;
                            delete targetPackageJson.dependencies![dep];
                        } else {
                            log += `Removing duplicate ${dep} from devDependencies (keeping in dependencies)\n`;
                            delete targetPackageJson.devDependencies![dep];
                        }
                    }

                    if (found) {
                        console.log(log);
                        // When write=false, we create a copy (targetPackageJson) so adding it to packageResult
                        // doesn't mutate the original. This allows validation to detect changes.
                        // When write=true, we modify the original object directly.
                        packageResult[packageJsonPath] = targetPackageJson;
                    }
                }
            }),
        ),
    );
};

export const logInconsistentDependencies = (allDeps: { [key: string]: Set<string> }): void => {
    Object.keys(allDeps).forEach((dep) => {
        if (allDeps[dep].size !== 1) {
            console.log(
                `Warning: inconsistent dependency versions ${dep} found ${
                    allDeps[dep].size
                } versions: ${[...allDeps[dep]].join(', ')}`,
            );
        }
    });
};

export const getLatestDependencyVersion = async (dependency: string): Promise<string | null> => {
    if (versionCache.has(dependency)) {
        return versionCache.get(dependency)!;
    }
    try {
        const execResult = await versionLimit(() => execPromise(`npm view ${dependency} version`));
        const latestVersion = execResult.stdout.trim();
        const result = latestVersion ? `^${latestVersion}` : null;
        if (!latestVersion) {
            console.log(`Could not determine version for ${dependency}`);
        }
        versionCache.set(dependency, result);
        return result;
    } catch (error) {
        console.error(`Error finding version for ${dependency}:`, error);
        versionCache.set(dependency, null);
        return null;
    }
};

export const addMissingDependencies = async (params: {
    packageJson: PackageJson;
    missingDeps: string[];
    packageName: string;
    workspacePackages: Set<string>;
    allDeps: { [key: string]: Set<string> };
    customCatalog?: Catalog;
}): Promise<string> => {
    const { packageJson, missingDeps, packageName, workspacePackages, allDeps, customCatalog } =
        params;
    let log = '';
    for (const dep of missingDeps) {
        if (dep === packageName) {
            log =
                `Warning: package ${packageName} appears to depend on itself - skipping self-dependency\n` +
                log;
            continue;
        }
        const catalog = customCatalog || (await getCachedCatalog());

        if (!allDeps[dep] || allDeps[dep].size === 0) {
            if (catalog && catalog[dep]) {
                allDeps[dep] = new Set([catalog[dep]]);
            } else if (workspacePackages.has(dep)) {
                allDeps[dep] = new Set(['workspace:*']);
            } else {
                const latestVersion = await getLatestDependencyVersion(dep);
                if (latestVersion) {
                    allDeps[dep] = new Set([latestVersion]);
                } else {
                    continue;
                }
            }
        }

        log += `adding ${dep}@${
            allDeps[dep].values().next().value
        } to ${packageName} package.json\n`;

        if (!packageJson.dependencies) {
            packageJson.dependencies = {};
        }

        packageJson.dependencies[dep] = allDeps[dep].values().next().value!;
    }
    for (const dep of Object.keys(packageJson.implicitDependencies || {})) {
        if (!packageJson.dependencies) {
            packageJson.dependencies = {};
        }
        if (!packageJson.dependencies[dep]) {
            log += `Adding implicit dependency ${dep}@${
                packageJson.implicitDependencies![dep]
            } to ${packageName} package.json\n`;
            packageJson.dependencies[dep] = packageJson.implicitDependencies![dep];
        }
    }
    return log;
};

export const removeUnusedDependencies = (
    packageJson: PackageJson,
    unusedDeps: string[],
    packageName: string,
): string => {
    let log = '';
    unusedDeps.forEach((dep: string) => {
        if (!packageJson.dependencies) {
            return;
        }
        if (packageJson.implicitDependencies && packageJson.implicitDependencies[dep]) {
            return;
        }
        log += `Removing ${dep} from ${packageName} package.json\n`;
        delete packageJson.dependencies[dep];
    });

    return log;
};

export const processPackageDependencies = async (params: {
    packageName: string;
    allDeps: { [key: string]: Set<string> };
    packageInfo?: PnpmPackageObject;
    workspacePackages: Set<string>;
    ignorePatterns?: string[];
    customCatalog?: Catalog;
}): Promise<[string, PackageJson] | null> => {
    const { packageName, allDeps, packageInfo, workspacePackages, ignorePatterns, customCatalog } =
        params;
    if (!packageInfo) {
        throw new Error(`Package ${packageName} not found in pnpmLsObject`);
    }

    const packageJsonPath = path.join(packageInfo.path, 'package.json');
    const packagePath = path.dirname(packageJsonPath);
    const patterns = [
        '.eslintrc.cjs',
        'docker/**/*.cjs',
        // Common heavy/generated dirs we can safely skip during dep scan
        'dist/**',
        'build/**',
        'target/**',
        'artifacts*/**',
        'hh-cache*/**',
        'cdk.out/**', // CDK build output
    ];
    if (ignorePatterns && ignorePatterns.length > 0) {
        patterns.push(...ignorePatterns.map((s: string) => s.trim()).filter(Boolean));
    }

    // Read .depcheckrc if it exists to get ignoreMatches
    let ignoreMatches: string[] = [];
    const depcheckrcPath = path.join(packagePath, '.depcheckrc');
    try {
        const rcContent = await fs.readFile(depcheckrcPath, 'utf-8');
        const rcConfig = JSON.parse(rcContent) as { ignores?: string[] };
        if (rcConfig.ignores && Array.isArray(rcConfig.ignores)) {
            ignoreMatches = rcConfig.ignores;
        }
    } catch {
        // .depcheckrc doesn't exist or is invalid, continue without it
    }

    let depcheckResults;
    try {
        depcheckResults = await depcheck(packagePath, {
            ignorePatterns: patterns,
            ignoreMatches,
        });
    } catch (error) {
        throw new Error(
            `Failed to run depcheck for ${packageName} at ${packagePath}: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }

    let packageJson: PackageJson;
    try {
        const fileContent = await fs.readFile(packageJsonPath, 'utf-8');
        packageJson = JSON.parse(fileContent) as PackageJson;
    } catch (error) {
        throw new Error(
            `Failed to read package.json for ${packageName} at ${packageJsonPath}: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }
    let makeChanges = false;
    let addLog = '';
    let removeLog = '';

    if (depcheckResults.dependencies.length > 0) {
        removeLog = removeUnusedDependencies(
            packageJson,
            depcheckResults.dependencies,
            packageName,
        );
        if (removeLog.length > 0) {
            makeChanges = true;
        }
    }

    if (
        Object.keys(depcheckResults.missing).length > 0 ||
        Object.keys(packageJson.implicitDependencies || {}).length > 0
    ) {
        addLog = await addMissingDependencies({
            packageJson,
            missingDeps: Object.keys(depcheckResults.missing),
            packageName,
            workspacePackages,
            allDeps,
            customCatalog,
        });
        if (addLog.length > 0) {
            makeChanges = true;
        }
    }

    if (addLog || removeLog) {
        console.log(`-----------------${packageName}-----------------------`);
        console.log(addLog);
        console.log(removeLog);
    }

    return makeChanges ? [packageJsonPath, packageJson] : null;
};

export const sortDependencies = (obj: Record<string, string>): Record<string, string> => {
    return Object.keys(obj)
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
        .reduce(
            (acc, key) => {
                acc[key] = obj[key];
                return acc;
            },
            {} as Record<string, string>,
        );
};

export const filterPackages = (params: {
    packages: string[];
    only?: string;
    ignore?: string;
    regex?: boolean;
}): string[] => {
    const { packages: packagesIn, only, ignore, regex = false } = params;
    let packages = packagesIn;

    if (only) {
        let filters = only.split(',').map((f: string) => f.trim());
        if (regex) {
            packages = packages.filter((p) =>
                filters.some((f: string) => safeRegexMatch({ str: p, pattern: f })),
            );
        } else {
            packages = packages.filter((p) => filters.some((f: string) => p === f));
        }
    }

    if (ignore) {
        let ignores = ignore.split(',').map((f: string) => f.trim());
        if (regex) {
            packages = packages.filter(
                (p) => !ignores.some((f: string) => safeRegexMatch({ str: p, pattern: f })),
            );
        } else {
            packages = packages.filter((p) => !ignores.some((f: string) => p === f));
        }
    }

    return packages;
};
