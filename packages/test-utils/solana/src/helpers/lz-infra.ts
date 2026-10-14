/**
 * LayerZero infrastructure initialization for test validators.
 *
 * Sets up endpoint, ULN, DVN, executor, pricefeed, and simple-messagelib
 * on a running solana-test-validator. Idempotent — checks PDA existence
 * before each init.
 */

import type { PublicKey, Signer, Umi, WrappedInstruction } from '@metaplex-foundation/umi';
import { none, some } from '@metaplex-foundation/umi';

import { secp256k1 } from '@layerzerolabs/lz-foundation';
import { UMI } from '@layerzerolabs/lz-solana-sdk-v2';

import {
    defaultMultiplierBps,
    DST_EID,
    DVN_SIGNERS,
    dvns,
    endpoint,
    executor,
    priceFeed,
    simpleMessageLib,
    SRC_EID,
    uln,
} from '../constants';
import { sendAndConfirm } from '../utils';
import { createSignerFromSeed } from './test-keys';

// ── Helper ───────────────────────────────────────────────────────────────────

/** Send instructions only if the guard PDA doesn't exist yet. */
const initIfNeeded = async (
    umi: Umi,
    guardPda: PublicKey,
    instructions: WrappedInstruction[],
    signer: Signer,
): Promise<void> => {
    if (!(await umi.rpc.getAccount(guardPda)).exists) {
        await sendAndConfirm(umi, instructions, signer);
    }
};

// ── Per-program init ─────────────────────────────────────────────────────────

const initEndpoint = async (umi: Umi, admin: Signer): Promise<void> => {
    await initIfNeeded(
        umi,
        endpoint.pda.setting()[0],
        [
            endpoint.initEndpoint(admin, { eid: SRC_EID, admin: admin.publicKey }),
            endpoint.registerLibrary(admin, { messageLibProgram: uln.programId }),
            endpoint.registerLibrary(admin, { messageLibProgram: simpleMessageLib.programId }),
            await endpoint.setDefaultSendLibrary(umi.rpc, admin, {
                messageLibProgram: uln.programId,
                remote: DST_EID,
            }),
            await endpoint.setDefaultReceiveLibrary(umi.rpc, admin, {
                messageLibProgram: uln.programId,
                remote: SRC_EID,
            }),
        ],
        admin,
    );
};

const initExecutor = async (umi: Umi, admin: Signer, infraExecutor: Signer): Promise<void> => {
    await initIfNeeded(
        umi,
        executor.pda.config()[0],
        [
            executor.initExecutor(admin, {
                admins: [admin.publicKey],
                executors: [infraExecutor.publicKey],
                msglibs: [uln.pda.messageLib()[0], simpleMessageLib.pda.messageLib()[0]],
                owner: admin.publicKey,
                priceFeed: priceFeed.pda.priceFeed()[0],
            }),
            executor.setPriceFeed(admin, priceFeed.programId),
            executor.setDefaultMultiplierBps(admin, defaultMultiplierBps),
            executor.setDstConfig(admin, [
                {
                    eid: DST_EID,
                    lzReceiveBaseGas: 10000,
                    lzComposeBaseGas: 10000,
                    multiplierBps: some(13000),
                    floorMarginUsd: some(10000n),
                    nativeDropCap: BigInt(1e7),
                } satisfies UMI.ExecutorProgram.types.DstConfig,
            ]),
        ],
        admin,
    );
};

const initPriceFeed = async (umi: Umi, admin: Signer): Promise<void> => {
    await initIfNeeded(
        umi,
        priceFeed.pda.priceFeed()[0],
        [
            priceFeed.initPriceFeed(admin, {
                admin: admin.publicKey,
                updaters: [admin.publicKey],
            }),
            priceFeed.setSolPrice(admin, BigInt(1e10)),
            priceFeed.setPrice(admin, {
                dstEid: DST_EID,
                priceRatio: BigInt(1e10),
                gasPriceInUnit: BigInt(1e9),
                gasPerByte: 1,
                modelType: {
                    __kind: 'Arbitrum',
                    gasPerL2Tx: BigInt(1e6),
                    gasPerL1CalldataByte: 1,
                },
            }),
        ],
        admin,
    );
};

const initDvns = async (umi: Umi, admin: Signer): Promise<void> => {
    // DVNs are independent — init in parallel.
    // dvn.initDVN() is async (throws if already initialized), so we check the PDA
    // manually instead of using initIfNeeded (which would evaluate the await before the check).
    await Promise.all(
        dvns.map(async (programId) => {
            const dvn = new UMI.DVNProgram.DVN(programId);
            const [configPda] = dvn.pda.config();
            if ((await umi.rpc.getAccount(configPda)).exists) return;

            await sendAndConfirm(
                umi,
                [
                    await dvn.initDVN(umi.rpc, admin, {
                        admins: [admin.publicKey],
                        signers: await Promise.all(
                            DVN_SIGNERS.map(async (s) =>
                                secp256k1.getPublicKey(s).then((r) => r.subarray(1)),
                            ),
                        ),
                        msglibs: [uln.pda.messageLib()[0]],
                        quorum: 1,
                        vid: DST_EID % 30000,
                        priceFeed: priceFeed.pda.priceFeed()[0],
                    }),
                    dvn.setDefaultMultiplierBps(admin, defaultMultiplierBps),
                    dvn.setPriceFeed(admin, priceFeed.programId),
                    dvn.setDstConfig(admin, [
                        {
                            eid: DST_EID,
                            dstGas: 10000,
                            multiplierBps: some(defaultMultiplierBps),
                            floorMarginUsd: none(),
                        },
                    ]),
                ],
                admin,
            );
        }),
    );
};

const initSimpleMessageLib = async (umi: Umi, admin: Signer): Promise<void> => {
    await initIfNeeded(
        umi,
        simpleMessageLib.pda.messageLib()[0],
        [
            simpleMessageLib.initSimpleMessageLib(admin, {
                admin: admin.publicKey,
                eid: SRC_EID,
                nativeFee: 1e4,
                lzTokenFee: 0,
            }),
            simpleMessageLib.setWhitelistCaller(admin, admin.publicKey),
        ],
        admin,
    );
};

const initUln = async (umi: Umi, admin: Signer): Promise<void> => {
    const requiredDvns = dvns.map((programId) => new UMI.DvnPDA(programId).config()[0]).sort();
    const ulnConfig: UMI.UlnProgram.types.UlnConfig = {
        confirmations: 1n,
        requiredDvnCount: requiredDvns.length,
        optionalDvnCount: 0,
        optionalDvnThreshold: 0,
        requiredDvns,
        optionalDvns: [],
    };
    const executorConfig: UMI.UlnProgram.types.ExecutorConfig = {
        maxMessageSize: 1024,
        executor: executor.pda.config()[0],
    };

    await initIfNeeded(
        umi,
        uln.pda.setting()[0],
        [
            uln.initUln(admin, {
                admin: admin.publicKey,
                eid: DST_EID,
                endpointProgram: endpoint.programId,
            }),
            uln.setTreasury(admin, {
                admin: admin.publicKey,
                lzToken: null,
                nativeFeeBps: 100,
                nativeReceiver: admin.publicKey,
            }),
            await uln.initOrUpdateDefaultConfig(umi.rpc, admin, {
                executorConfig: some(executorConfig),
                receiveUlnConfig: some(ulnConfig),
                remote: SRC_EID,
                sendUlnConfig: some(ulnConfig),
            }),
            await uln.initOrUpdateDefaultConfig(umi.rpc, admin, {
                executorConfig: some(executorConfig),
                receiveUlnConfig: some(ulnConfig),
                remote: DST_EID,
                sendUlnConfig: some(ulnConfig),
            }),
        ],
        admin,
    );
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize LayerZero infrastructure on the test validator.
 * Idempotent — safe to call multiple times.
 */
export const initInfrastructure = async (umi: Umi): Promise<void> => {
    const admin = umi.payer;
    const infraExecutor = createSignerFromSeed('infra-executor');

    await initEndpoint(umi, admin);
    await initExecutor(umi, admin, infraExecutor);
    await initPriceFeed(umi, admin);
    await initDvns(umi, admin);
    await initSimpleMessageLib(umi, admin);
    await initUln(umi, admin);
};
