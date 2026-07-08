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
    miniRoot: string;
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
    miniRoot: string;
    dependencyNames: readonly string[];
}

export interface RootNodeModulesSymlinkCopyResult {
    nodeModulesPath: string;
    symlinks: string[];
}

export interface MiniWorkspaceOptions {
    cwd?: string;
    pruner?: MiniWorkspacePruner;
}

export interface MiniWorkspace {
    packageRoot: string;
    repoRoot: string;
    miniRoot: string;
    packageRelativePath: string;
    pnpmVirtualStoreMount: PnpmVirtualStoreMount;
    copiedWorkspacePackageCount: number;
    copiedWorkspacePackagePaths: Record<string, string>;
    prunerName?: string;
    diagnostics: string[];
}

export interface MiniWorkspacePruner {
    name: string;
    createPrunePlan: (input: MiniWorkspacePrunerInput) => Promise<MiniWorkspacePrunePlan>;
}

export interface MiniWorkspacePrunerInput {
    repoRoot: string;
    packageRoot: string;
    packageRelativePath: string;
    cwd: string;
    dependencyGraph: WorkspaceDependencyGraph;
}

export interface MiniWorkspacePrunePlan {
    patterns: readonly string[];
    /** Overrides keyed by workspace package relative path. */
    packagePatterns?: Readonly<Record<string, readonly string[]>>;
    diagnostics?: readonly string[];
}
