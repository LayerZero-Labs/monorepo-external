/**
 * Test helpers and utilities for Stellar OneSig tests
 */

import { StrKey, xdr } from '@stellar/stellar-sdk';
import { randomBytes } from 'crypto';
import { Wallet } from 'ethers';

import { StellarCall } from '../src/index';

/**
 * Create test Ethereum wallets for EIP-712 signing
 */
export function createTestEthWallets(count = 3): Wallet[] {
    return Array.from({ length: count }, () => Wallet.createRandom());
}

/**
 * Generate a test contract address (C...)
 */
export function generateTestContractAddress(): string {
    const bytes = randomBytes(32);
    return StrKey.encodeContract(bytes);
}

/**
 * Create a test call with function name and arguments
 * Encoding is handled internally by the leaf generator
 * Arguments can be provided as ScVal[] directly
 */
export function createTestCall(
    contractAddress?: string,
    functionName = 'set_seed',
    args: xdr.ScVal[] = [],
): StellarCall {
    const contract = contractAddress || generateTestContractAddress();

    return {
        contractAddress: contract,
        functionName,
        args,
    };
}

/**
 * Get test seed for signing
 */
export function getTestSeed(): string {
    return '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
}

/**
 * Get test expiry (1 hour from now)
 */
export function getTestExpiry(): number {
    return Math.floor(Date.now() / 1000) + 3600;
}

/**
 * Stellar chain ID constant
 */
export const STELLAR_CHAIN_ID = 40161n;
