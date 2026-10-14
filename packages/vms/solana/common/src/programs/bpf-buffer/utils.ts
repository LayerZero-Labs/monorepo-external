import type { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';

import { BpfLoaderUpgradeable } from './bpf-upgradable';

export const getBufferTransactions = async (args: {
    connection: Connection;
    programBuffer: Buffer;
    walletPk: PublicKey;
    bufferPk: PublicKey;
    programPk: PublicKey;
    additionalInstructionSize?: number;
}): Promise<{
    createBufferInstructions: TransactionInstruction[];
    loadBufferInstructions: TransactionInstruction[];
    deployProgramInstructions: TransactionInstruction[];
}> => {
    const bufferSize = BpfLoaderUpgradeable.getBufferAccountSize(args.programBuffer.length);

    return {
        createBufferInstructions: await BpfLoaderUpgradeable.createBuffer(
            args.walletPk,
            args.bufferPk,
            await args.connection.getMinimumBalanceForRentExemption(bufferSize),
            bufferSize,
        ),
        loadBufferInstructions: await BpfLoaderUpgradeable.createLoadBufferInstructions(
            args.walletPk,
            args.bufferPk,
            args.programBuffer,
            args.additionalInstructionSize ?? 0,
        ),
        deployProgramInstructions: await BpfLoaderUpgradeable.deployProgram(
            args.walletPk,
            args.bufferPk,
            args.programPk,
            await args.connection.getMinimumBalanceForRentExemption(
                BpfLoaderUpgradeable.getBufferAccountSize(BpfLoaderUpgradeable.BUFFER_PROGRAM_SIZE),
            ),
            args.programBuffer.length,
        ),
    };
};
