import type { PublicKey } from '@metaplex-foundation/umi';
import { publicKey } from '@metaplex-foundation/umi';

import type { Network } from '@layerzerolabs/lz-definitions';

/**
 * Supported programs.
 */
export type SupportedPrograms =
    | 'endpoint'
    | 'simple_messagelib'
    | 'uln'
    | 'blocked_messagelib'
    | 'executor'
    | 'pricefeed'
    | 'dvn';

/**
 * Interface representing a deployment.
 */
export interface Deployment {
    /**
     * The name of the supported program.
     */
    name: SupportedPrograms;

    /**
     * The network of the deployment.
     */
    network: Network;

    /**
     * The address of the deployment.
     */
    address: string;

    /**
     * Compatible versions of the deployment.
     */
    compatibleVersions: string[];

    /**
     * The deployer of the deployment.
     */
    deployer: string;
}

/**
 * Gets the program keypair.
 *
 * @param {Network | 'default'} network - The network.
 * @param {SupportedPrograms} program - The supported program.
 * @returns {PublicKey} The public key of the program.
 */
export function getProgramKeypair(
    network: Network | 'default',
    program: SupportedPrograms,
): PublicKey {
    network = network === 'default' ? 'solana-sandbox-local' : network;
    const deployment = require(
        `@layerzerolabs/lz-solana-sdk-v2/deployments/${network}/${program}.json`,
    ) as Deployment;
    return publicKey(deployment.address);
}

/**
 * Gets the endpoint program ID.
 *
 * @param {Network | 'default'} network - The network.
 * @returns {PublicKey} The public key of the endpoint program.
 */
export function getEndpointProgramId(network: Network | 'default'): PublicKey {
    return getProgramKeypair(network, 'endpoint');
}

/**
 * Gets the simple message library program ID.
 *
 * @param {Network | 'default'} network - The network.
 * @returns {PublicKey} The public key of the simple message library program.
 */
export function getSimpleMessageLibProgramId(network: Network | 'default'): PublicKey {
    return getProgramKeypair(network, 'simple_messagelib');
}

/**
 * Gets the ULN program ID.
 *
 * @param {Network | 'default'} network - The network.
 * @returns {PublicKey} The public key of the ULN program.
 */
export function getULNProgramId(network: Network | 'default'): PublicKey {
    return getProgramKeypair(network, 'uln');
}

/**
 * Gets the DVN program ID.
 *
 * @param {Network | 'default'} network - The network.
 * @returns {PublicKey} The public key of the DVN program.
 */
export function getDVNProgramId(network: Network | 'default'): PublicKey {
    return getProgramKeypair(network, 'dvn');
}

/**
 * Gets the blocked message library program ID.
 *
 * @param {Network | 'default'} network - The network.
 * @returns {PublicKey} The public key of the blocked message library program.
 */
export function getBlockedMessageLibProgramId(network: Network | 'default'): PublicKey {
    return getProgramKeypair(network, 'blocked_messagelib');
}

/**
 * Gets the executor program ID.
 *
 * @param {Network | 'default'} network - The network.
 * @returns {PublicKey} The public key of the executor program.
 */
export function getExecutorProgramId(network: Network | 'default'): PublicKey {
    return getProgramKeypair(network, 'executor');
}

/**
 * Gets the pricefeed program ID.
 *
 * @param {Network | 'default'} network - The network.
 * @returns {PublicKey} The public key of the pricefeed program.
 */
export function getPricefeedProgramId(network: Network | 'default'): PublicKey {
    return getProgramKeypair(network, 'pricefeed');
}
