import 'hardhat/types/config';
import 'hardhat/types/runtime';

interface TronSolcCompiler {
    version: string;
    settings?: {
        optimizer?: { enabled?: boolean; [key: string]: unknown };
        metadata?: { [key: string]: unknown };
    };
}

declare module 'hardhat/types/runtime' {
    interface Network {
        tron?: boolean;
    }
}

declare module 'hardhat/types/config' {
    interface HttpNetworkConfig {
        tron?: boolean;
    }
    interface HardhatNetworkConfig {
        tron?: boolean;
    }
    interface HttpNetworkUserConfig {
        tron?: boolean;
    }
    interface HardhatNetworkUserConfig {
        tron?: boolean;
    }
    interface HardhatUserConfig {
        tronSolc?: {
            enable?: boolean;
            compilers?: TronSolcCompiler[];
            filter?: string[];
            versionRemapping?: [string, string][];
        };
    }
    interface HardhatConfig {
        tronSolc: {
            enable: boolean;
            compilers: TronSolcCompiler[];
            filter: Set<string>;
            versionRemapping: Map<string, string>;
        };
    }
}

export declare const getTronSolcPath: (version: string) => Promise<string>;
