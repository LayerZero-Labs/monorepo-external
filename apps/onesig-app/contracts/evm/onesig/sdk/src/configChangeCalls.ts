import { ethers } from 'ethers';

import type { ConfigChangeOperation, OneSigConfigChangeCall } from '@layerzerolabs/onesig-model';

const ONESIG_IFACE = new ethers.utils.Interface([
    'function setSigner(address _signer, bool _active)',
    'function setThreshold(uint256 _threshold)',
    'function setSeed(bytes32 _seed)',
    'function setExecutor(address _executor, bool _active)',
]);

/**
 * Generate an EVM config-change call for a single chain.
 *
 * @param operation - The config-change operation.
 * @param contractAddress - The OneSig contract address on this chain.
 * @param chainName - The chain name (e.g. "ethereum").
 * @param params - Operation-specific parameters:
 *   - setSigner / removeSigner: `{ address: string }`
 *   - setThreshold: `{ threshold: number }`
 *   - setSeed: `{ seed: string }` (hex-encoded bytes32)
 *   - setExecutor / removeExecutor: `{ address: string }`
 */
export function generateEvmConfigChangeCall(
    operation: ConfigChangeOperation,
    contractAddress: string,
    chainName: string,
    params: Record<string, unknown>,
): OneSigConfigChangeCall {
    let data: string;

    switch (operation) {
        case 'setSigner':
            data = ONESIG_IFACE.encodeFunctionData('setSigner', [params.address, true]);
            break;
        case 'removeSigner':
            data = ONESIG_IFACE.encodeFunctionData('setSigner', [params.address, false]);
            break;
        case 'setThreshold':
            data = ONESIG_IFACE.encodeFunctionData('setThreshold', [params.threshold]);
            break;
        case 'setSeed':
            data = ONESIG_IFACE.encodeFunctionData('setSeed', [params.seed]);
            break;
        case 'setExecutor':
            data = ONESIG_IFACE.encodeFunctionData('setExecutor', [params.address, true]);
            break;
        case 'removeExecutor':
            data = ONESIG_IFACE.encodeFunctionData('setExecutor', [params.address, false]);
            break;
        default:
            throw new Error(`Unsupported EVM config change operation: ${operation}`);
    }

    return {
        chainName,
        to: contractAddress,
        value: '0',
        data,
    };
}
