import { type EVMBuildTarget } from '@layerzerolabs/common-evm';

export enum Templates {
    ARTIFACT = 'artifact.ts.hbs',
    INDEX = 'index.ts.hbs',
}

// Configuration interface for artifact generation
export interface ArtifactConfig {
    artifactsDir: string;
    outputDir: string;
    generatedDir: string;
    abiImportPrefix: string;
    flattenedSolSupport?: boolean;
}

export interface ContractBuildTargetInfo {
    artifactFileName: string;
    hasFlattenedSol: boolean;
}

export interface ContractInfo {
    name: string;
    abiId: string;
    abiImportPath: string;
    buildTargets: Partial<Record<EVMBuildTarget, ContractBuildTargetInfo>>;
}
