import type { PublicKey } from '@metaplex-foundation/umi';
import { publicKey } from '@metaplex-foundation/umi';

import { addresses } from './addresses';

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
 * Gets the program ID.
 *
 * @param {SupportedPrograms} program - The supported program.
 * @returns {PublicKey} The public key of the program.
 */
export const getProgramId = (program: SupportedPrograms): PublicKey =>
    publicKey(addresses[program]);

/**
 * Gets the endpoint program ID.
 *
 * @returns {PublicKey} The public key of the endpoint program.
 */
export const getEndpointProgramId = (): PublicKey => getProgramId('endpoint');

/**
 * Gets the simple message library program ID.
 *
 * @returns {PublicKey} The public key of the simple message library program.
 */
export const getSimpleMessageLibProgramId = (): PublicKey => getProgramId('simple_messagelib');

/**
 * Gets the ULN program ID.
 *
 * @returns {PublicKey} The public key of the ULN program.
 */
export const getULNProgramId = (): PublicKey => getProgramId('uln');

/**
 * Gets the DVN program ID.
 *
 * @returns {PublicKey} The public key of the DVN program.
 */
export const getDVNProgramId = (): PublicKey => getProgramId('dvn');

/**
 * Gets the blocked message library program ID.
 *
 * @returns {PublicKey} The public key of the blocked message library program.
 */
export const getBlockedMessageLibProgramId = (): PublicKey => getProgramId('blocked_messagelib');

/**
 * Gets the executor program ID.
 *
 * @returns {PublicKey} The public key of the executor program.
 */
export const getExecutorProgramId = (): PublicKey => getProgramId('executor');

/**
 * Gets the pricefeed program ID.
 *
 * @returns {PublicKey} The public key of the pricefeed program.
 */
export const getPricefeedProgramId = (): PublicKey => getProgramId('pricefeed');
