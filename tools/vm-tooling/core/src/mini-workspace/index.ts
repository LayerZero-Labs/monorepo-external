import { resolve } from 'node:path';

import { safeRemove } from '../utils/fs';
import { copyRootNodeModulesSymlinks, getPnpmVirtualStoreMount } from './node-modules';
import type {
    MiniWorkspace,
    MiniWorkspaceOptions,
    MiniWorkspacePrunePlan,
    MiniWorkspacePruner,
    MiniWorkspacePrunerInput,
    WorkspaceDependencyGraph,
} from './types';
import { resolveWorkspaceDependencyGraph } from './workspace-dependency-graph';
import { copyWorkspaceSources } from './workspace-source-copy';

export type {
    MiniWorkspace,
    MiniWorkspaceOptions,
    MiniWorkspacePrunePlan,
    MiniWorkspacePruner,
    MiniWorkspacePrunerInput,
    PnpmVirtualStoreMount,
    WorkspaceDependencyEdge,
    WorkspaceDependencyGraph,
} from './types';
export { DEFAULT_SOURCE_COPY_PATTERNS } from './workspace-source-copy';

const FALLBACK_DIAGNOSTIC =
    'No mini-workspace pruner configured; using unpruned package-level source copy fallback.';

interface PrunerResolution {
    prunerName?: string;
    prunePlan?: MiniWorkspacePrunePlan;
    diagnostics: string[];
}

const createPrunerInput = ({
    dependencyGraph,
    cwd,
}: {
    dependencyGraph: WorkspaceDependencyGraph;
    cwd: string;
}): MiniWorkspacePrunerInput => ({
    repoRoot: dependencyGraph.repoRoot,
    packageRoot: dependencyGraph.packageRoot,
    packageRelativePath: dependencyGraph.packageRelativePath,
    cwd,
    dependencyGraph,
});

const collectDiagnostics = (
    ...sources: readonly (MiniWorkspacePrunePlan | void | undefined)[]
): string[] => sources.flatMap((source) => (source?.diagnostics ? [...source.diagnostics] : []));

const resolvePruner = async ({
    pruner,
    dependencyGraph,
    cwd,
}: {
    pruner?: MiniWorkspacePruner;
    dependencyGraph: WorkspaceDependencyGraph;
    cwd: string;
}): Promise<PrunerResolution> => {
    if (!pruner) {
        return { diagnostics: [FALLBACK_DIAGNOSTIC] };
    }

    const input = createPrunerInput({ dependencyGraph, cwd });
    const prunePlan = await pruner.createPrunePlan(input);

    return {
        prunerName: pruner.name,
        prunePlan,
        diagnostics: collectDiagnostics(prunePlan),
    };
};

/** Create the shared mini-workspace filesystem used by containerized package builds. */
export const createMiniWorkspace = async (
    options: MiniWorkspaceOptions = {},
): Promise<MiniWorkspace> => {
    const cwd = resolve(options.cwd ?? process.cwd());
    const dependencyGraph = await resolveWorkspaceDependencyGraph({
        cwd,
    });
    const prunerResolution = await resolvePruner({
        pruner: options.pruner,
        dependencyGraph,
        cwd,
    });
    const sourceCopy = await copyWorkspaceSources({
        dependencyGraph,
        prunePatterns: prunerResolution.prunePlan?.patterns,
        packagePrunePatterns: prunerResolution.prunePlan?.packagePatterns,
    });

    try {
        await copyRootNodeModulesSymlinks({
            repoRoot: dependencyGraph.repoRoot,
            miniRoot: sourceCopy.miniRoot,
            dependencyNames: dependencyGraph.rootNodeModulesDependencyNames,
        });
    } catch (error) {
        await safeRemove(sourceCopy.miniRoot);
        throw error;
    }

    const copiedPackagePathEntries = sourceCopy.copiedWorkspaceDependencies
        .map((dependency) => [dependency.relativePath, dependency.absolutePath] as const)
        .sort(([a], [b]) => a.localeCompare(b));

    return {
        packageRoot: dependencyGraph.packageRoot,
        repoRoot: dependencyGraph.repoRoot,
        miniRoot: sourceCopy.miniRoot,
        packageRelativePath: dependencyGraph.packageRelativePath,
        pnpmVirtualStoreMount: getPnpmVirtualStoreMount(dependencyGraph.repoRoot),
        copiedWorkspacePackageCount: copiedPackagePathEntries.length,
        copiedWorkspacePackagePaths: Object.fromEntries(copiedPackagePathEntries),
        prunerName: prunerResolution.prunerName,
        diagnostics: prunerResolution.diagnostics,
    };
};
