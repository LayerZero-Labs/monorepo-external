import { Environment } from '@layerzerolabs/lz-definitions';

/**
 * Array of IDL types.
 */
export const idlTypes = [
    'MessageLibQuoteParams',
    'MessageLibSendParams',
    'MessagingFee',
    'MessagingReceipt',
    'PacketForQuote',
    'Packet',
    'InitConfigParams',
    'MessageLibSetConfigParams',
    'MessageLibSnapshotConfigParams',
    'MessageLibResetConfigParams',
];

/**
 * Array of message libraries.
 */
export const messageLibs = ['uln', 'simple_messagelib'];

/**
 * Faucet URLs for different environments.
 */
export const FAUCET_URL: { [env in Environment]: string } = {
    [Environment.MAINNET]: '',
    [Environment.TESTNET]: '',
    [Environment.DEVNET]: '',
    [Environment.LOCAL]: 'http://127.0.0.1:9900',
};
