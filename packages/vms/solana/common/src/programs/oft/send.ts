import type { PublicKey as UmiPublicKey, RpcInterface } from '@metaplex-foundation/umi';
import { createNoopSigner, publicKey } from '@metaplex-foundation/umi';
import { toWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters';
import {
    getAssociatedTokenAddressSync,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import type { TransactionInstruction } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';

import { NonRetryableError } from '@layerzerolabs/common-error-utils';
import { oft302 } from '@layerzerolabs/oft-v2-solana-sdk';

import type { SolanaProvider } from '../../provider';
import { getOftProgramId, getOftStore } from './queries';

/**
 * Parameters for quoting an OFT send operation
 */
export interface QuoteOftSendParams {
    /** The OFT store address (base58) */
    oftStore: string;
    /** The payer's wallet address (base58) */
    walletAddress: string;
    /** Destination endpoint ID */
    dstEid: number;
    /** Recipient address as bytes32 */
    to: Uint8Array;
    /** Amount to send in local decimals */
    amountLd: bigint;
    /** Minimum amount to receive in local decimals */
    minAmountLd: bigint;
    /** Extra options for the message */
    options: Uint8Array;
    /** Whether to pay in LZ token */
    payInLzToken?: boolean;
    /** Compose message (optional) */
    composeMsg?: Uint8Array;
}

/**
 * Result of quoting an OFT send
 */
export interface QuoteOftSendResult {
    nativeFee: bigint;
    lzTokenFee: bigint;
}

/**
 * Parameters for building an OFT send instruction
 */
export interface BuildOftSendParams extends QuoteOftSendParams {
    /** Native fee to pay */
    nativeFee: bigint;
    /** LZ token fee to pay (usually 0) */
    lzTokenFee?: bigint;
}

/**
 * Quote an OFT send operation
 */
export const quoteOftSend = async (
    rpc: RpcInterface,
    provider: SolanaProvider,
    params: QuoteOftSendParams,
    remainingAccounts: { pubkey: UmiPublicKey; isSigner: boolean; isWritable: boolean }[],
): Promise<QuoteOftSendResult> => {
    const { oftStore, walletAddress, dstEid, to, amountLd, minAmountLd, options, payInLzToken } =
        params;

    const oftProgramId = await getOftProgramId({
        provider,
        localOapp: oftStore,
    });

    if (!oftProgramId) {
        throw new NonRetryableError(`OFT Program ID not found for ${oftStore}`);
    }

    // Fetch OFT store data once and read both tokenMint and tokenEscrow from it
    // to avoid duplicate RPC calls.
    const oftStoreData = await getOftStore({ provider, oftStore });
    if (!oftStoreData) {
        throw new NonRetryableError(`OFT store not found: ${oftStore}`);
    }
    const tokenMint = oftStoreData.tokenMint.toString();
    const tokenEscrow = oftStoreData.tokenEscrow.toString();

    const quoteFee = await oft302.quote(
        rpc,
        {
            payer: publicKey(walletAddress),
            tokenMint: publicKey(tokenMint),
            tokenEscrow: publicKey(tokenEscrow),
            peerAddr: to,
        },
        {
            dstEid,
            to,
            amountLd,
            minAmountLd,
            options,
            payInLzToken: payInLzToken ?? false,
            composeMsg: params.composeMsg,
        },
        {
            oft: publicKey(oftProgramId.toBase58()),
        },
        remainingAccounts,
    );

    return {
        nativeFee: quoteFee.nativeFee,
        lzTokenFee: quoteFee.lzTokenFee ?? 0n,
    };
};

/**
 * Build an OFT send instruction
 */
export const buildOftSendInstruction = async (
    rpc: RpcInterface,
    provider: SolanaProvider,
    params: BuildOftSendParams,
    remainingAccounts: { pubkey: UmiPublicKey; isSigner: boolean; isWritable: boolean }[],
): Promise<TransactionInstruction> => {
    const {
        oftStore,
        walletAddress,
        dstEid,
        to,
        amountLd,
        minAmountLd,
        options,
        nativeFee,
        lzTokenFee,
    } = params;

    const oftProgramId = await getOftProgramId({
        provider,
        localOapp: oftStore,
    });

    if (!oftProgramId) {
        throw new NonRetryableError(`OFT Program ID not found for ${oftStore}`);
    }

    // Fetch OFT store data once and read both tokenMint and tokenEscrow from it
    // to avoid duplicate RPC calls.
    const oftStoreData = await getOftStore({ provider, oftStore });
    if (!oftStoreData) {
        throw new NonRetryableError(`OFT store not found: ${oftStore}`);
    }
    const tokenMint = oftStoreData.tokenMint.toString();
    const tokenEscrow = oftStoreData.tokenEscrow.toString();

    // Determine which token program owns the mint (Token or Token-2022)
    // to correctly derive the associated token account for the sender.
    const tokenMintPubkey = new PublicKey(tokenMint);
    const mintAccountInfo = await provider.connection.getAccountInfo(tokenMintPubkey);
    if (!mintAccountInfo) {
        throw new NonRetryableError(`Token mint account not found: ${tokenMint}`);
    }
    const tokenProgramId = mintAccountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
        ? TOKEN_2022_PROGRAM_ID
        : TOKEN_PROGRAM_ID;

    // Get the sender's associated token account using the detected token program
    const tokenSource = getAssociatedTokenAddressSync(
        tokenMintPubkey,
        new PublicKey(walletAddress),
        false,
        tokenProgramId,
    );

    // Create a noop signer for the payer since we're building the instruction,
    // not actually signing it here. The actual signing happens when the transaction is sent.
    const payerSigner = createNoopSigner(publicKey(walletAddress));

    const sendIxBuilder = await oft302.send(
        rpc,
        {
            payer: payerSigner,
            tokenMint: publicKey(tokenMint),
            tokenEscrow: publicKey(tokenEscrow),
            tokenSource: publicKey(tokenSource.toBase58()),
            peerAddr: to,
        },
        {
            dstEid,
            to,
            amountLd,
            minAmountLd,
            nativeFee,
            lzTokenFee: lzTokenFee ?? 0n,
            options,
            composeMsg: params.composeMsg,
        },
        {
            oft: publicKey(oftProgramId.toBase58()),
            token: publicKey(tokenProgramId.toBase58()),
        },
        remainingAccounts,
    );

    return toWeb3JsInstruction(sendIxBuilder.instruction);
};
