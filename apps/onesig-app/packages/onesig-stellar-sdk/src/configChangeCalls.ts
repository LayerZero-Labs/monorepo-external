import type { ConfigChangeOperation, OneSigConfigChangeCall } from '@layerzerolabs/onesig-model';

import {
    createSetExecutorCall,
    createSetSeedCall,
    createSetSignerCall,
    createSetThresholdCall,
} from './calls';
import type { StellarCall } from './leafGenerator';

/**
 * Serialize a Stellar call into the normalized `OneSigConfigChangeCall` shape.
 *
 * The `data` field carries a JSON object `{ functionName, args }` where each
 * arg is the base64-encoded XDR of the `ScVal`. The downstream `toStellarCall`
 * shaper parses this format.
 */
function toConfigChangeCall(chainName: string, call: StellarCall): OneSigConfigChangeCall {
    return {
        chainName,
        to: call.contractAddress,
        value: '0',
        data: JSON.stringify({
            functionName: call.functionName,
            args: call.args.map((arg) => arg.toXDR('base64')),
        }),
    };
}

/**
 * Generate a Stellar config-change call for a single chain.
 *
 * @param operation - The config-change operation.
 * @param contractAddress - The OneSig contract address on this chain (C...).
 * @param chainName - The chain name (e.g. "stellar-mainnet").
 * @param params - Operation-specific parameters:
 *   - setSigner / removeSigner: `{ address: string }` (hex-encoded 32-byte key)
 *   - setThreshold: `{ threshold: number }`
 *   - setSeed: `{ seed: string }` (hex-encoded 32 bytes)
 *   - setExecutor / removeExecutor: `{ address: string }` (hex-encoded 32-byte key)
 */
export function generateStellarConfigChangeCall(
    operation: ConfigChangeOperation,
    contractAddress: string,
    chainName: string,
    params: Record<string, unknown>,
): OneSigConfigChangeCall {
    switch (operation) {
        case 'setSigner':
            return toConfigChangeCall(
                chainName,
                createSetSignerCall(
                    Buffer.from((params.address as string).replace(/^0x/, ''), 'hex'),
                    true,
                    contractAddress,
                ),
            );
        case 'removeSigner':
            return toConfigChangeCall(
                chainName,
                createSetSignerCall(
                    Buffer.from((params.address as string).replace(/^0x/, ''), 'hex'),
                    false,
                    contractAddress,
                ),
            );
        case 'setThreshold':
            return toConfigChangeCall(
                chainName,
                createSetThresholdCall(params.threshold as number, contractAddress),
            );
        case 'setSeed':
            return toConfigChangeCall(
                chainName,
                createSetSeedCall(
                    Buffer.from((params.seed as string).replace(/^0x/, ''), 'hex'),
                    contractAddress,
                ),
            );
        case 'setExecutor':
            return toConfigChangeCall(
                chainName,
                createSetExecutorCall(
                    Buffer.from((params.address as string).replace(/^0x/, ''), 'hex'),
                    true,
                    contractAddress,
                ),
            );
        case 'removeExecutor':
            return toConfigChangeCall(
                chainName,
                createSetExecutorCall(
                    Buffer.from((params.address as string).replace(/^0x/, ''), 'hex'),
                    false,
                    contractAddress,
                ),
            );
        default:
            throw new Error(`Unsupported Stellar config change operation: ${operation}`);
    }
}
