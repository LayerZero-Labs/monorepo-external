export interface ContractConfig {
    name: string;
    file?: string;
    rename?: string;
    isVerifiable?: boolean;
}

export interface DirectoryConfig {
    name: string;
    rename?: string;
}

export interface ArtifactPackagesConfig {
    config: {
        byChainType?: string[];
        byChainName?: string[];
    };
    contracts: Record<string, ContractConfig[]>;
    directories: Record<string, DirectoryConfig[]>;
    helpers: Record<string, { paths: string[]; name: string }[]>;
}

export type ResolvePath = (relativePathWithinPackage: string) => string;

export type PostGenerateOperationsInput = {
    resolvePath: ResolvePath;
    packageRoot: string;
    targets: string[];
    artifactsPackageConfig: ArtifactPackagesConfig;
};
