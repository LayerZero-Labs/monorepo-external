import type { Instruction, PublicKey } from '@metaplex-foundation/umi';
import { createNoopSigner, publicKey as toPublicKey } from '@metaplex-foundation/umi';

import type { ConfigChangeOperation, OneSigConfigChangeCall } from '@layerzerolabs/onesig-model';

import { ONESIG_PROGRAM_ID } from './index';
import { OneSig } from './onesig';

/**
 * Serialize a Solana `Instruction` into the normalized `OneSigConfigChangeCall`
 * shape expected by the downstream `toSolanaCall` shaper.
 *
 * The shaper reads `metadata.programId` and `metadata.keys`; the `data` field
 * carries the hex-encoded instruction data.
 *
 * IMPORTANT: `OneSig.setConfig()` prepends the program ID as `keys[0]` for the
 * execute_transaction CPI flow. The downstream `toSolanaCall` shaper also
 * prepends a CPI target account as `keys[0]`. To avoid a double-prepend we
 * strip the first key here — `toSolanaCall` will re-add it.
 */
function instructionToConfigChangeCall(
    chainName: string,
    contractAddress: string,
    ix: Instruction,
): OneSigConfigChangeCall {
    const hexData = '0x' + Buffer.from(ix.data).toString('hex');

    // Skip keys[0] (the programId that setConfig prepends) — toSolanaCall adds its own.
    const keysWithoutCpiTarget = ix.keys.slice(1);

    return {
        chainName,
        to: contractAddress,
        value: '0',
        data: hexData,
        metadata: {
            programId: ix.programId.toString(),
            keys: keysWithoutCpiTarget.map((k) => ({
                pubkey: k.pubkey.toString(),
                isSigner: k.isSigner,
                isWritable: k.isWritable,
            })),
        },
    };
}

/**
 * Generate a Solana config-change call for a single chain.
 *
 * @param operation - The config-change operation.
 * @param contractAddress - The OneSig state account address (base58).
 * @param chainName - The chain name (e.g. "solana-mainnet").
 * @param params - Operation-specific parameters:
 *   - setSigner / removeSigner: `{ address: string }` (hex-encoded 32-byte pubkey, with or without 0x prefix)
 *   - setThreshold: `{ threshold: number }`
 *   - setSeed: `{ seed: string }` (hex-encoded 32-byte seed)
 *   - setExecutor / removeExecutor: `{ address: string }` (base58 Solana pubkey)
 * @param programId - Optional OneSig program ID override. Defaults to the canonical program ID.
 */
export function generateSolanaConfigChangeCall(
    operation: ConfigChangeOperation,
    contractAddress: string,
    chainName: string,
    params: Record<string, unknown>,
    programId: PublicKey = ONESIG_PROGRAM_ID,
): OneSigConfigChangeCall {
    const statePublicKey = toPublicKey(contractAddress);
    const oneSig = new OneSig(programId, createNoopSigner(statePublicKey));

    let ix: Instruction;

    switch (operation) {
        case 'setSigner': {
            const signerBytes = hexToBytes(params.address as string);
            ix = oneSig.addSigner(signerBytes);
            break;
        }
        case 'removeSigner': {
            const signerBytes = hexToBytes(params.address as string);
            ix = oneSig.removeSigner(signerBytes);
            break;
        }
        case 'setThreshold':
            ix = oneSig.setThreshold(params.threshold as number);
            break;
        case 'setSeed': {
            const seedBytes = hexToBytes(params.seed as string);
            ix = oneSig.setSeed(seedBytes);
            break;
        }
        case 'setExecutor':
            ix = oneSig.addExecutor(toPublicKey(params.address as string));
            break;
        case 'removeExecutor':
            ix = oneSig.removeExecutor(toPublicKey(params.address as string));
            break;
        default:
            throw new Error(`Unsupported Solana config change operation: ${operation}`);
    }

    return instructionToConfigChangeCall(chainName, contractAddress, ix);
}

/** Convert a hex string (with or without 0x prefix) to Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}
