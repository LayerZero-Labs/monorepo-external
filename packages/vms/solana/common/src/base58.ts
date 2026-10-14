import { Message, PACKET_DATA_SIZE, PublicKey } from '@solana/web3.js';
import base58 from 'bs58';

import { NonRetryableError } from '@layerzerolabs/common-error-utils';

import { replaceFeePayerInTransactionInstructions } from './feePayer';
import { deserializeTransactionInstructions } from './serialization';
import { isPartialWalletTransferInstruction, type SolanaTransaction } from './transaction';

export interface Base58MessageInput {
    /** `replaceAllInjectedPubKeys` is read off this, not passed separately, so the payer swap matches the signing path. */
    transaction: SolanaTransaction;
    /** Base58 pubkey set as the message fee payer and substituted for the injected-payer placeholder. */
    feePayer: string;
    /** Environment whose injected-payer placeholder is replaced (e.g. `mainnet`). */
    environment: string;
    /** Any valid base58 blockhash; the importer rebuilds it at execution time. */
    recentBlockhash: string;
}

/**
 * Compile a Solana transaction into a base58-encoded legacy message for an external multisig to
 * import (e.g. Squads' "Import base58 encoded tx"). `feePayer` is set as the message payer and
 * swapped in for the injected simulation payer; the importer supplies the real signer.
 *
 * Emits a legacy `Message` only: no v0 / address-lookup-table support, so it's bound by the
 * ~1232-byte tx ceiling. Extend to `MessageV0` if larger txs are ever needed.
 */
export const serializeSolanaTransactionToBase58Message = ({
    transaction,
    feePayer,
    environment,
    recentBlockhash,
}: Base58MessageInput): string => {
    const { instructions } = transaction.populatedTransaction;
    if (isPartialWalletTransferInstruction(instructions)) {
        throw new NonRetryableError(
            'serializeSolanaTransactionToBase58Message: partial wallet-transfer instructions are not supported',
        );
    }

    let payer: PublicKey;
    try {
        payer = new PublicKey(feePayer);
    } catch {
        throw new NonRetryableError(
            `serializeSolanaTransactionToBase58Message: invalid base58 feePayer "${feePayer}"`,
        );
    }

    const withPayer = replaceFeePayerInTransactionInstructions(
        environment,
        payer,
        deserializeTransactionInstructions(instructions),
        transaction.replaceAllInjectedPubKeys,
    );
    const message = Message.compile({
        instructions: withPayer,
        payerKey: payer,
        recentBlockhash,
    });

    let serialized: Buffer;
    try {
        serialized = message.serialize();
    } catch (err) {
        // serialize() throws a RangeError once the message passes PACKET_DATA_SIZE; rethrow anything else.
        // An importer like Squads re-wraps these into its own tx (extra overhead), so this is a lower
        // bound on the real import/execute limit, not the exact ceiling.
        if (!(err instanceof RangeError)) throw err;
        throw new NonRetryableError(
            `serializeSolanaTransactionToBase58Message: compiled message exceeds the ${PACKET_DATA_SIZE}-byte tx limit`,
        );
    }
    return base58.encode(serialized);
};
