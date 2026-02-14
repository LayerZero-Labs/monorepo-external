export interface PackageJson {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    implicitDependencies?: Record<string, string>;
    private?: boolean;
    publishConfig?: {
        access: string;
        registry: string;
    };
    [key: string]: any;
}

export interface PnpmPackageObject {
    name: string;
    path: string;
}

export type VersionType = 'major' | 'minor' | 'patch' | 'none';
export type Catalog = Record<string, string>;

export interface PnpmWorkspace {
    packages: string[];
    catalog: Catalog;
    cleanupUnusedCatalogs: boolean;
}

export interface FixDependenciesParams {
    only?: string;
    ignore?: string;
    ignorePatterns?: string[];
    toDev?: string;
    regex?: boolean;
    sort?: boolean;
    write?: boolean;
    catalogize?: boolean;
    customCatalog?: Catalog;
    preventCatalogsCleanup?: boolean;
    cwd?: string;
    dups?: boolean;
}

export interface ValidateDependenciesParams {
    missingDependencies?: boolean;
    only?: string;
    ignorePatterns?: string[];
    dups?: boolean;
    catalog?: boolean;
}

export interface GraphData {
    nodes: string[];
    links: { source: string; target: string }[];
    packageName: string;
}

export enum Direction {
    From = 'from',
    To = 'to',
}
