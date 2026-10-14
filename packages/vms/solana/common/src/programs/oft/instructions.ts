import type { RpcInterface } from '@metaplex-foundation/umi';
import { createNoopSigner, publicKey } from '@metaplex-foundation/umi';
import { toWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters';
import type { TransactionInstruction } from '@solana/web3.js';

import type { SetConfigType } from '@layerzerolabs/lz-solana-sdk-v2';
import { UlnProgram } from '@layerzerolabs/lz-solana-sdk-v2';
import type { UlnProgram as UmiUlnProgram } from '@layerzerolabs/lz-solana-sdk-v2/umi';
import { oft302 } from '@layerzerolabs/oft-v2-solana-sdk';

const toOftSetConfig = (
    config: UlnProgram.types.ExecutorConfig | UlnProgram.types.UlnConfig,
): UmiUlnProgram.types.ExecutorConfig | UmiUlnProgram.types.UlnConfig =>
    'executor' in config
        ? {
              ...config,
              executor: publicKey(config.executor.toBase58()),
          }
        : {
              ...config,
              confirmations: BigInt(config.confirmations.toString()),
              requiredDvns: config.requiredDvns.map((dvn) => publicKey(dvn.toBase58())),
              optionalDvns: config.optionalDvns.map((dvn) => publicKey(dvn.toBase58())),
          };

export const getInitOftInstruction = (args: {
    accounts: { payer: string; admin: string; mint: string; escrow: string };
    oftType: oft302.types.OFTType;
    sharedDecimals: number;
    programs: { oft: string; endpoint?: string; token?: string };
}): TransactionInstruction => {
    const { accounts, oftType, sharedDecimals, programs } = args;
    const { oft, endpoint, token } = programs;

    const instructions = oft302.initOft(
        {
            payer: createNoopSigner(publicKey(accounts.payer)),
            admin: publicKey(accounts.admin),
            mint: publicKey(accounts.mint),
            escrow: createNoopSigner(publicKey(accounts.escrow)),
        },
        oftType,
        sharedDecimals,
        {
            oft: publicKey(oft),
            endpoint: endpoint ? publicKey(endpoint) : undefined,
            token: token ? publicKey(token) : undefined,
        },
    );
    return toWeb3JsInstruction(instructions.instruction);
};

export const getSetEnforcedOptionsInstruction = (args: {
    accounts: {
        admin: string;
        oftStore: string;
    };
    remote: number;
    send: Uint8Array;
    sendAndCall: Uint8Array;
    oftProgramId: string;
}): TransactionInstruction => {
    const { admin, oftStore } = args.accounts;
    const { remote, send, sendAndCall } = args;

    const instructions = oft302.setPeerConfig(
        {
            admin: createNoopSigner(publicKey(admin)),
            oftStore: publicKey(oftStore),
        },
        {
            remote,
            __kind: 'EnforcedOptions',
            send,
            sendAndCall,
        },
        publicKey(args.oftProgramId),
    );
    return toWeb3JsInstruction(instructions.instruction);
};

export const getSetPeerInstruction = (args: {
    accounts: {
        admin: string;
        oftStore: string;
    };
    remote: number;
    peer: Uint8Array;
    oftProgramId: string;
}): TransactionInstruction => {
    const { admin, oftStore } = args.accounts;
    const { remote, peer } = args;

    const instructions = oft302.setPeerConfig(
        {
            admin: createNoopSigner(publicKey(admin)),
            oftStore: publicKey(oftStore),
        },
        {
            remote,
            __kind: 'PeerAddress',
            peer,
        },
        publicKey(args.oftProgramId),
    );
    return toWeb3JsInstruction(instructions.instruction);
};

export const getInitReceiveLibraryInstruction = (args: {
    accounts: {
        admin: string;
        oftStore: string;
    };
    remoteEid: number;
}): TransactionInstruction => {
    const { admin, oftStore } = args.accounts;
    const { remoteEid } = args;

    const instructions = oft302.initReceiveLibrary(
        {
            admin: createNoopSigner(publicKey(admin)),
            oftStore: publicKey(oftStore),
        },
        remoteEid,
    );

    return toWeb3JsInstruction(instructions.instruction);
};

export const getSetReceiveLibraryInstruction = (args: {
    accounts: {
        admin: string;
        oftStore: string;
    };
    receiveLibraryProgram: string;
    remoteEid: number;
    gracePeriod: bigint;
    ulnProgramId: string;
}): TransactionInstruction => {
    const { admin, oftStore } = args.accounts;
    const { receiveLibraryProgram, remoteEid, gracePeriod } = args;

    const instructions = oft302.setReceiveLibrary(
        {
            admin: createNoopSigner(publicKey(admin)),
            oftStore: publicKey(oftStore),
        },
        {
            receiveLibraryProgram: publicKey(receiveLibraryProgram),
            remoteEid,
            gracePeriod,
        },
    );

    return toWeb3JsInstruction(instructions.instruction);
};

export const getInitSendLibraryInstruction = (args: {
    accounts: {
        admin: string;
        oftStore: string;
    };
    remoteEid: number;
}): TransactionInstruction => {
    const { admin, oftStore } = args.accounts;
    const { remoteEid } = args;

    const instructions = oft302.initSendLibrary(
        {
            admin: createNoopSigner(publicKey(admin)),
            oftStore: publicKey(oftStore),
        },
        remoteEid,
    );

    return toWeb3JsInstruction(instructions.instruction);
};

export const getSetSendLibraryInstruction = (args: {
    accounts: {
        admin: string;
        oftStore: string;
    };
    sendLibraryProgram: string;
    remoteEid: number;
    ulnProgramId: string;
}): TransactionInstruction => {
    const { admin, oftStore } = args.accounts;
    const { sendLibraryProgram, remoteEid } = args;

    const instructions = oft302.setSendLibrary(
        {
            admin: createNoopSigner(publicKey(admin)),
            oftStore: publicKey(oftStore),
        },
        {
            sendLibraryProgram: publicKey(sendLibraryProgram),
            remoteEid,
        },
    );

    return toWeb3JsInstruction(instructions.instruction);
};

// Configs
export const getInitConfigInstruction = (args: {
    accounts: {
        admin: string;
        oftStore: string;
    };
    remoteEid: number;
}): TransactionInstruction => {
    const { admin, oftStore } = args.accounts;
    const { remoteEid } = args;

    const instructions = oft302.initConfig(
        {
            admin: createNoopSigner(publicKey(admin)),
            oftStore: publicKey(oftStore),
            payer: createNoopSigner(publicKey(admin)),
        },
        remoteEid,
        { msgLib: publicKey(UlnProgram.PROGRAM_ID) },
    );

    return toWeb3JsInstruction(instructions.instruction);
};

export const getSetConfigInstruction = async (
    rpc: RpcInterface,
    args: {
        accounts: {
            admin: string;
            oftStore: string;
        };
        remoteEid: number;
        config: UlnProgram.types.ExecutorConfig | UlnProgram.types.UlnConfig;
        configType: SetConfigType;
    },
): Promise<TransactionInstruction> => {
    const { admin, oftStore } = args.accounts;
    const { remoteEid, config, configType } = args;
    const instructions = await oft302.setConfig(
        rpc,
        {
            signer: createNoopSigner(publicKey(admin)),
            oftStore: publicKey(oftStore),
        },
        {
            configType,
            config: toOftSetConfig(config),
            remoteEid,
        },
        { msgLib: publicKey(UlnProgram.PROGRAM_ID) },
    );

    return toWeb3JsInstruction(instructions.instruction);
};

// Oapp Nonce
export const getInitOAppNonceInstruction = (args: {
    accounts: {
        admin: string;
        oftStore: string;
    };
    remoteEid: number;
    remoteOAppAddr: Uint8Array;
}): TransactionInstruction => {
    const { admin, oftStore } = args.accounts;
    const { remoteEid, remoteOAppAddr } = args;

    const instructions = oft302.initOAppNonce(
        {
            admin: createNoopSigner(publicKey(admin)),
            oftStore: publicKey(oftStore),
        },
        remoteEid,
        remoteOAppAddr,
    );

    return toWeb3JsInstruction(instructions.instruction);
};

export const getSetDelegateInstruction = (args: {
    accounts: {
        admin: string;
        oftStore: string;
    };
    programs: { oft: string; endpoint?: string };
    delegate: string;
}): TransactionInstruction => {
    const { delegate, programs, accounts } = args;
    const { admin, oftStore } = accounts;

    const ix = oft302.setOFTConfig(
        {
            admin: createNoopSigner(publicKey(admin)),
            oftStore: publicKey(oftStore),
        },
        {
            __kind: 'Delegate',
            delegate: publicKey(delegate),
        },
        {
            oft: publicKey(programs.oft),
        },
    );

    return toWeb3JsInstruction(ix.instruction);
};

export const getSetAdminInstruction = (args: {
    accounts: {
        admin: string;
        oftStore: string;
    };
    programs: { oft: string; endpoint?: string };
    admin: string;
}): TransactionInstruction => {
    const { admin: newAdmin, programs, accounts } = args;
    const { admin, oftStore } = accounts;

    const ix = oft302.setOFTConfig(
        {
            admin: createNoopSigner(publicKey(admin)),
            oftStore: publicKey(oftStore),
        },
        {
            __kind: 'Admin',
            admin: publicKey(newAdmin),
        },
        {
            oft: publicKey(programs.oft),
        },
    );

    return toWeb3JsInstruction(ix.instruction);
};
