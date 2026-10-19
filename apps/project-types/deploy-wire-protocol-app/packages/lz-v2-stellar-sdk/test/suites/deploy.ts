import type { Asset, Keypair, rpc } from '@stellar/stellar-sdk';

import {
    deployAssetSac as deployAssetSacEnv,
    deployContract as deployContractEnv,
    deployNativeSac as deployNativeSacEnv,
    deployZroToken as deployZroTokenEnv,
    uploadWasm as uploadWasmEnv,
} from '@layerzerolabs/test-utils-stellar';

import { env } from './constants.js';

export async function uploadWasm(
    wasmBuffer: Buffer,
    keypair: Keypair,
    server: rpc.Server,
): Promise<string> {
    return uploadWasmEnv(env, wasmBuffer, keypair, server);
}

export async function deployContract<T extends { options: { contractId: string } }>(
    ClientClass: {
        deploy: (
            argsOrOptions: any,
            options?: any,
        ) => Promise<{ signAndSend: () => Promise<{ result: T }> }>;
    },
    wasmFilePath: string,
    constructorArgs: any | undefined,
    deployer: Keypair,
    options: {
        salt?: Buffer;
        wasmHash?: string;
        rpcUrl?: string;
        networkPassphrase?: string;
        allowHttp?: boolean;
    } = {},
): Promise<T> {
    return deployContractEnv(env, ClientClass, wasmFilePath, constructorArgs, deployer, options);
}

export async function deployNativeSac(): Promise<void> {
    return deployNativeSacEnv(env);
}

export async function deployZroToken(): Promise<void> {
    return deployZroTokenEnv(env);
}

export async function deployAssetSac(asset: Asset): Promise<string> {
    return deployAssetSacEnv(env, asset);
}
