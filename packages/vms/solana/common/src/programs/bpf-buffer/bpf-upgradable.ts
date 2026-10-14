import * as BufferLayout from '@solana/buffer-layout';
import {
    PACKET_DATA_SIZE,
    PublicKey,
    SystemProgram,
    SYSVAR_CLOCK_PUBKEY,
    SYSVAR_RENT_PUBKEY,
    TransactionInstruction,
} from '@solana/web3.js';

import type { SolanaProvider } from '../../provider';
import type { InstructionType } from './instruction';
import { encodeData } from './instruction';
import * as Layout from './layout';

export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
    'BPFLoaderUpgradeab1e11111111111111111111111',
);

// Magic number based on the memory layout of BPF_LOADER_UPGRADEABLE_PROGRAM_ID program data account
export const UPGRADE_AUTHORITY_OFFSET = 13;

export const getUpgradeAuthorityForProgram = async (
    provider: SolanaProvider,
    programAddress: string,
): Promise<PublicKey> => {
    const [programDataAddress] = PublicKey.findProgramAddressSync(
        [new PublicKey(programAddress).toBuffer()],
        BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    );

    const programDataAccountInfo = await provider.connection.getAccountInfo(programDataAddress);

    // Extract the upgrade authority from the account data
    const upgradeAuthorityBuffer = programDataAccountInfo!.data.slice(
        UPGRADE_AUTHORITY_OFFSET,
        UPGRADE_AUTHORITY_OFFSET + 32,
    );

    const upgradeAuthority = new PublicKey(upgradeAuthorityBuffer);
    return upgradeAuthority;
};

/**
 * An enumeration of valid BpfUpgradeableLoaderInstructionType's
 */
type BpfUpgradeableLoaderInstructionType =
    | 'InitializeBuffer'
    | 'Write'
    | 'DeployWithMaxDataLen'
    | 'Upgrade'
    | 'SetAuthority'
    | 'Close';

/**
 * An enumeration of valid system InstructionType's
 * @internal
 */
const BPF_UPGRADEABLE_LOADER_INSTRUCTION_LAYOUTS: {
    [_type in BpfUpgradeableLoaderInstructionType]: InstructionType;
} = Object.freeze({
    InitializeBuffer: {
        index: 0,
        layout: BufferLayout.struct<BufferLayout.UInt>([BufferLayout.u32('instruction')]),
    },
    Write: {
        index: 1,
        layout: BufferLayout.struct<BufferLayout.UInt>([
            BufferLayout.u32('instruction'),
            BufferLayout.u32('offset'),
            Layout.rustVecBytes('bytes'),
        ]),
    },
    DeployWithMaxDataLen: {
        index: 2,
        layout: BufferLayout.struct<BufferLayout.UInt>([
            BufferLayout.u32('instruction'),
            BufferLayout.u32('maxDataLen'),
            BufferLayout.u32('maxDataLenPadding'),
        ]),
    },
    Upgrade: {
        index: 3,
        layout: BufferLayout.struct<BufferLayout.UInt>([BufferLayout.u32('instruction')]),
    },
    SetAuthority: {
        index: 4,
        layout: BufferLayout.struct<BufferLayout.UInt>([BufferLayout.u32('instruction')]),
    },
    Close: {
        index: 5,
        layout: BufferLayout.struct<BufferLayout.UInt>([BufferLayout.u32('instruction')]),
    },
});

/**
 * Initialize buffer tx params
 */
type InitializeBufferParams = {
    /** Public key of the buffer account */
    bufferPk: PublicKey;
    /** Public key to set as authority of the initialized buffer */
    authorityPk: PublicKey;
};

/**
 * Write tx params
 */
type WriteParams = {
    /** Offset at which to write the given bytes. */
    offset: number;
    /** Chunk of program data */
    bytes: Buffer;
    /** Public key of the buffer account */
    bufferPk: PublicKey;
    /** Public key to set as authority of the initialized buffer */
    authorityPk: PublicKey;
};

/**
 * Deploy a program tx params
 */
type DeployWithMaxProgramLenParams = {
    /** Maximum length that the program can be upgraded to. */
    maxDataLen: number;
    /** The uninitialized Program account */
    programPk: PublicKey;
    /** The buffer account where the program data has been written. The buffer account’s authority must match the program’s authority */
    bufferPk: PublicKey;
    /** The program’s authority */
    upgradeAuthorityPk: PublicKey;
    /** The payer account that will pay to create the ProgramData account */
    payerPk: PublicKey;
};

/**
 * Upgrade tx params
 */
type UpgradeParams = {
    /** The program account */
    programPk: PublicKey;
    /** The buffer account where the program data has been written. The buffer account’s authority must match the program’s authority */
    bufferPk: PublicKey;
    /** The spill account */
    spillPk: PublicKey;
    /** The program’s authority */
    authorityPk: PublicKey;
};

/**
 * Update buffer authority tx params
 */
type SetBufferAuthorityParams = {
    /** The buffer account where the program data has been written */
    bufferPk: PublicKey;
    /** The buffer's authority */
    authorityPk: PublicKey;
    /** New buffer's authority */
    newAuthorityPk: PublicKey;
};

/**
 * Update program authority tx params
 */
type SetUpgradeAuthorityParams = {
    /** The program account */
    programPk: PublicKey;
    /** The current authority */
    authorityPk: PublicKey;
    /** The new authority, optional, if omitted then the program will not be upgradeable */
    newAuthorityPk: PublicKey | undefined;
};

/**
 * Close account tx params
 */
type CloseParams = {
    /** The account to close */
    closePk: PublicKey;
    /** The account to deposit the closed account’s lamports */
    recipientPk: PublicKey;
    /** The account’s authority, Optional, required for initialized accounts */
    authorityPk: PublicKey | undefined;
    /** The associated Program account if the account to close is a ProgramData account */
    programPk: PublicKey | undefined;
};

/**
 * Factory class for txs to interact with the BpfLoaderUpgradeable program
 */
class BpfLoaderUpgradeableProgram {
    /**
     * Public key that identifies the BpfLoaderUpgradeable program
     */
    static programId: PublicKey = BPF_LOADER_UPGRADEABLE_PROGRAM_ID;

    /**
     * Derive programData address from program
     */
    static async getProgramDataAddress(programPk: PublicKey): Promise<PublicKey> {
        return (await PublicKey.findProgramAddress([programPk.toBuffer()], this.programId))[0];
    }

    /**
     * Generate a tx instruction that initialize buffer account
     */
    static initializeBuffer(params: InitializeBufferParams): TransactionInstruction {
        const type = BPF_UPGRADEABLE_LOADER_INSTRUCTION_LAYOUTS.InitializeBuffer;
        const data = encodeData(type, {});

        return new TransactionInstruction({
            keys: [
                { pubkey: params.bufferPk, isSigner: false, isWritable: true },
                {
                    pubkey: params.authorityPk,
                    isSigner: false,
                    isWritable: false,
                },
            ],
            programId: this.programId,
            data,
        });
    }

    /**
     * Generate a tx instruction that write a chunk of program data
     *   to a buffer account
     */
    static write(params: WriteParams): TransactionInstruction {
        const type = BPF_UPGRADEABLE_LOADER_INSTRUCTION_LAYOUTS.Write;
        const data = encodeData(type, {
            offset: params.offset,
            bytes: params.bytes,
        });

        return new TransactionInstruction({
            keys: [
                { pubkey: params.bufferPk, isSigner: false, isWritable: true },
                {
                    pubkey: params.authorityPk,
                    isSigner: true,
                    isWritable: false,
                },
            ],
            programId: this.programId,
            data,
        });
    }

    /**
     * Generate a tx instruction that deploy a program with a specified
     *   maximum program length
     */
    static async deployWithMaxProgramLen(
        params: DeployWithMaxProgramLenParams,
    ): Promise<TransactionInstruction> {
        const type = BPF_UPGRADEABLE_LOADER_INSTRUCTION_LAYOUTS.DeployWithMaxDataLen;
        const data = encodeData(type, {
            maxDataLen: params.maxDataLen,
            maxDataLenPadding: 0,
        });

        const programDataPk = await this.getProgramDataAddress(params.programPk);

        return new TransactionInstruction({
            keys: [
                { pubkey: params.payerPk, isSigner: true, isWritable: true },
                { pubkey: programDataPk, isSigner: false, isWritable: true },
                { pubkey: params.programPk, isSigner: false, isWritable: true },
                { pubkey: params.bufferPk, isSigner: false, isWritable: true },
                {
                    pubkey: SYSVAR_RENT_PUBKEY,
                    isSigner: false,
                    isWritable: false,
                },
                {
                    pubkey: SYSVAR_CLOCK_PUBKEY,
                    isSigner: false,
                    isWritable: false,
                },
                {
                    pubkey: SystemProgram.programId,
                    isSigner: false,
                    isWritable: false,
                },
                {
                    pubkey: params.upgradeAuthorityPk,
                    isSigner: true,
                    isWritable: false,
                },
            ],
            programId: this.programId,
            data,
        });
    }

    /**
     * Generate a tx instruction that upgrade a program
     */
    static async upgrade(params: UpgradeParams): Promise<TransactionInstruction> {
        const type = BPF_UPGRADEABLE_LOADER_INSTRUCTION_LAYOUTS.Upgrade;
        const data = encodeData(type, {});

        const programDataPk = await this.getProgramDataAddress(params.programPk);

        return new TransactionInstruction({
            keys: [
                { pubkey: programDataPk, isSigner: false, isWritable: true },
                { pubkey: params.programPk, isSigner: false, isWritable: true },
                { pubkey: params.bufferPk, isSigner: false, isWritable: true },
                { pubkey: params.spillPk, isSigner: true, isWritable: true },
                {
                    pubkey: SYSVAR_RENT_PUBKEY,
                    isSigner: false,
                    isWritable: false,
                },
                {
                    pubkey: SYSVAR_CLOCK_PUBKEY,
                    isSigner: false,
                    isWritable: false,
                },
                {
                    pubkey: params.authorityPk,
                    isSigner: true,
                    isWritable: false,
                },
            ],
            programId: this.programId,
            data,
        });
    }

    /**
     * Generate a tx instruction that set a new buffer authority
     */
    static setBufferAuthority(params: SetBufferAuthorityParams): TransactionInstruction {
        const type = BPF_UPGRADEABLE_LOADER_INSTRUCTION_LAYOUTS.SetAuthority;
        const data = encodeData(type, {});

        return new TransactionInstruction({
            keys: [
                { pubkey: params.bufferPk, isSigner: false, isWritable: true },
                {
                    pubkey: params.authorityPk,
                    isSigner: true,
                    isWritable: false,
                },
                {
                    pubkey: params.newAuthorityPk,
                    isSigner: false,
                    isWritable: false,
                },
            ],
            programId: this.programId,
            data,
        });
    }

    /**
     * Generate a tx instruction that set a new program authority
     */
    static async setUpgradeAuthority(
        params: SetUpgradeAuthorityParams,
    ): Promise<TransactionInstruction> {
        const type = BPF_UPGRADEABLE_LOADER_INSTRUCTION_LAYOUTS.SetAuthority;
        const data = encodeData(type, {});

        const programDataPk = await this.getProgramDataAddress(params.programPk);

        const keys = [
            { pubkey: programDataPk, isSigner: false, isWritable: true },
            {
                pubkey: params.authorityPk,
                isSigner: true,
                isWritable: false,
            },
        ];

        if (params.newAuthorityPk) {
            keys.push({
                pubkey: params.newAuthorityPk,
                isSigner: false,
                isWritable: false,
            });
        }

        return new TransactionInstruction({
            keys,
            programId: this.programId,
            data,
        });
    }

    /**
     * Generate a tx instruction that close program, buffer, or
     *   uninitialized account
     */
    static close(params: CloseParams): TransactionInstruction {
        const type = BPF_UPGRADEABLE_LOADER_INSTRUCTION_LAYOUTS.Close;
        const data = encodeData(type, {});

        const keys = [
            { pubkey: params.closePk, isSigner: false, isWritable: true },
            {
                pubkey: params.recipientPk,
                isSigner: false,
                isWritable: true,
            },
        ];

        if (params.authorityPk) {
            keys.push({
                pubkey: params.authorityPk,
                isSigner: true,
                isWritable: false,
            });
        }

        if (params.programPk) {
            keys.push({
                pubkey: params.programPk,
                isSigner: false,
                isWritable: true,
            });
        }

        return new TransactionInstruction({
            keys,
            programId: this.programId,
            data,
        });
    }
}

/**
 * BpfLoaderUpgradeable program interface
 */
export class BpfLoaderUpgradeable {
    /**
     * Buffer account size without data
     */
    static BUFFER_HEADER_SIZE: number = 37; // Option<Pk>

    /**
     * Program account size
     */
    static BUFFER_PROGRAM_SIZE: number = 36; // Pk

    /**
     * ProgramData account size without data
     */
    static BUFFER_PROGRAM_DATA_HEADER_SIZE: number = 45; // usize + Option<Pk>

    /**
     * Maximal chunk of the data per tx
     */
    static WRITE_CHUNK_SIZE: number = PACKET_DATA_SIZE - 220; // Data with 1 signature

    /**
     * Get buffer account size
     */
    static getBufferAccountSize(programLen: number): number {
        return this.BUFFER_HEADER_SIZE + programLen;
    }

    /**
     * Create and initialize buffer account
     */
    static async createBuffer(
        walletPk: PublicKey,
        bufferPk: PublicKey,
        lamports: number,
        space: number,
    ): Promise<TransactionInstruction[]> {
        return [
            SystemProgram.createAccount({
                fromPubkey: walletPk,
                newAccountPubkey: bufferPk,
                lamports,
                space: space,
                programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
            }),
            BpfLoaderUpgradeableProgram.initializeBuffer({
                bufferPk: bufferPk,
                authorityPk: walletPk,
            }),
        ];
    }

    /**
     * Update buffer authority
     */
    static async setBufferAuthority(
        walletPk: PublicKey,
        bufferPk: PublicKey,
        newAuthorityPk: PublicKey,
    ): Promise<TransactionInstruction[]> {
        return [
            BpfLoaderUpgradeableProgram.setBufferAuthority({
                bufferPk,
                authorityPk: walletPk,
                newAuthorityPk,
            }),
        ];
    }

    /**
     * Load programData to initialized buffer account
     */
    static async createLoadBufferInstructions(
        walletPk: PublicKey,
        bufferPk: PublicKey,
        programData: Buffer,
        additionalInstructionSize: number = 0,
    ): Promise<TransactionInstruction[]> {
        let bytesOffset = 0;

        const instructions: TransactionInstruction[] = [];

        while (true) {
            const offset = bytesOffset;
            bytesOffset += BpfLoaderUpgradeable.WRITE_CHUNK_SIZE - additionalInstructionSize;

            const bytes = programData.subarray(
                offset,
                offset + BpfLoaderUpgradeable.WRITE_CHUNK_SIZE - additionalInstructionSize,
            );

            if (bytes.length === 0) {
                break;
            }

            instructions.push(
                BpfLoaderUpgradeableProgram.write({
                    offset,
                    bytes,
                    bufferPk,
                    authorityPk: walletPk,
                }),
            );
        }
        return instructions;
    }

    /**
     * Close buffer account and withdraw funds
     */
    static async closeBuffer(
        walletPk: PublicKey,
        bufferPk: PublicKey,
    ): Promise<TransactionInstruction[]> {
        return [
            BpfLoaderUpgradeableProgram.close({
                closePk: bufferPk,
                recipientPk: walletPk,
                authorityPk: walletPk,
                programPk: undefined,
            }),
        ];
    }

    /**
     * create program account from initialized buffer
     */
    static async deployProgram(
        walletPk: PublicKey,
        bufferPk: PublicKey,
        programPk: PublicKey,
        programLamports: number,
        maxDataLen: number,
    ): Promise<TransactionInstruction[]> {
        return [
            SystemProgram.createAccount({
                fromPubkey: walletPk,
                newAccountPubkey: programPk,
                lamports: programLamports,
                space: this.BUFFER_PROGRAM_SIZE,
                programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
            }),
            await BpfLoaderUpgradeableProgram.deployWithMaxProgramLen({
                programPk,
                bufferPk,
                upgradeAuthorityPk: walletPk,
                payerPk: walletPk,
                maxDataLen,
            }),
        ];
    }

    /**
     * Update program authority
     */
    static async setProgramAuthority(
        programPk: PublicKey,
        walletPk: PublicKey,
        newAuthorityPk: PublicKey | undefined,
    ): Promise<TransactionInstruction[]> {
        return [
            await BpfLoaderUpgradeableProgram.setUpgradeAuthority({
                programPk,
                authorityPk: walletPk,
                newAuthorityPk,
            }),
        ];
    }

    /**
     * Upgrade a program
     */
    static async upgradeProgram(
        programPk: PublicKey,
        walletPk: PublicKey,
        bufferPk: PublicKey,
        spillPk: PublicKey,
    ): Promise<TransactionInstruction[]> {
        return [
            await BpfLoaderUpgradeableProgram.upgrade({
                programPk,
                bufferPk,
                spillPk,
                authorityPk: walletPk,
            }),
        ];
    }

    /**
     * Close program account and withdraw funds
     */
    static async closeProgram(
        programPk: PublicKey,
        walletPk: PublicKey,
    ): Promise<TransactionInstruction[]> {
        return [
            BpfLoaderUpgradeableProgram.close({
                closePk: await BpfLoaderUpgradeableProgram.getProgramDataAddress(programPk),
                recipientPk: walletPk,
                authorityPk: walletPk,
                programPk,
            }),
        ];
    }
}
