export interface WorkspaceDependencyEdge {
    name: string;
    importerRelativePath: string;
    relativePath: string;
    absolutePath: string;
    version: string;
}

export interface WorkspaceDependencyGraph {
    repoRoot: string;
    packageRoot: string;
    packageRelativePath: string;
    /** Root node_modules symlink names referenced by the workspace package closure. */
    rootNodeModulesDependencyNames: string[];
    includedWorkspaceDependencies: WorkspaceDependencyEdge[];
}

export interface WorkspaceDependencyGraphOptions {
    /** Package root whose workspace dependency graph should be calculated. */
    cwd?: string;
    /** Repository root. Defaults to the nearest ancestor containing pnpm-workspace.yaml. */
    repoRoot?: string;
}

export interface WorkspaceSourceCopyOptions {
    dependencyGraph: WorkspaceDependencyGraph;
    /** Ordered package-relative include/exclude expressions for workspace source copies. */
    prunePatterns?: readonly string[];
    /** Package-relative path overrides for workspace source copies. */
    packagePrunePatterns?: Readonly<Record<string, readonly string[]>>;
}

export interface WorkspaceSourceCopyResult {
    repoRoot: string;
    packageRoot: string;
    scopedRoot: string;
    packageRelativePath: string;
    copiedWorkspaceDependencies: WorkspaceDependencyEdge[];
}

export interface PnpmVirtualStoreMount {
    hostPath: string;
    containerPath: string;
    readOnly: true;
}

export interface RootNodeModulesSymlinkCopyOptions {
    repoRoot: string;
    scopedRoot: string;
    dependencyNames: readonly string[];
}

export interface RootNodeModulesSymlinkCopyResult {
    nodeModulesPath: string;
    symlinks: string[];
}

export interface ScopedWorkspaceOptions {
    cwd?: string;
    pruner?: ScopedWorkspacePruner;
}

export interface ScopedWorkspace {
    packageRoot: string;
    repoRoot: string;
    scopedRoot: string;
    packageRelativePath: string;
    pnpmVirtualStoreMount: PnpmVirtualStoreMount;
    copiedWorkspacePackageCount: number;
    copiedWorkspacePackagePaths: Record<string, string>;
    prunerName?: string;
    diagnostics: string[];
}

export interface ScopedWorkspacePruner {
    name: string;
    createPrunePlan: (input: ScopedWorkspacePrunerInput) => Promise<ScopedWorkspacePrunePlan>;
}

export interface ScopedWorkspacePrunerInput {
    repoRoot: string;
    packageRoot: string;
    packageRelativePath: string;
    cwd: string;
    dependencyGraph: WorkspaceDependencyGraph;
}

export interface ScopedWorkspacePrunePlan {
    patterns: readonly string[];
    /** Overrides keyed by workspace package relative path. */
    packagePatterns?: Readonly<Record<string, readonly string[]>>;
    diagnostics?: readonly string[];
}
