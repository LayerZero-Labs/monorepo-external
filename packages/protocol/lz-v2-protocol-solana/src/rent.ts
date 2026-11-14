import type { RpcInterface, WrappedInstruction } from '@metaplex-foundation/umi';
import { ACCOUNT_HEADER_SIZE, transactionBuilder } from '@metaplex-foundation/umi';

export const RECEIVE_LIBRARY_CONFIG_SPACE = 82;
export const ULN_SEND_CONFIG_SPACE = 1088;
export const ULN_RECEIVE_CONFIG_SPACE = 1052;

export const withCreatedAccounts = (
    ix: WrappedInstruction,
    spaces: number[],
): WrappedInstruction => ({
    ...ix,
    bytesCreatedOnChain:
        ix.bytesCreatedOnChain +
        spaces.reduce((total, space) => total + ACCOUNT_HEADER_SIZE + space, 0),
});

export const getCreatedAccountsRentLamports = async (
    rpc: RpcInterface,
    ix: WrappedInstruction,
): Promise<bigint> => {
    if (ix.bytesCreatedOnChain === 0) return 0n;
    const { basisPoints: lamports } = await transactionBuilder([ix]).getRentCreatedOnChain({
        rpc,
    });
    return lamports;
};
