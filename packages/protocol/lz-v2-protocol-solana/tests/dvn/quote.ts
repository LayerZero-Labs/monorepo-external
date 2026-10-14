import { generateSigner, none, PublicKey, WrappedInstruction } from '@metaplex-foundation/umi';
import { u64 } from '@metaplex-foundation/umi/serializers';
import { assert } from 'vitest';
import { it } from 'vitest';

import { accounts, DVN, DVN_PROGRAM_ID } from '../../src/dvn';
import {
    EidNotSupportedError,
    MsgLibNotAllowedError,
    PausedError,
    QuoteDvnInstructionArgs,
} from '../../src/generated/dvn';
import { PermissionDeniedError } from '../../src/generated/worker_interface';
import { SolanaTestValidator } from '../setup';
import {
    calDvnFee,
    dvnPDA,
    DVNSigner,
    eddsa,
    MAX_VERIFIER_SIGNERS,
    onChainExpiration,
    priceFeedPda,
    sendAndConfirm,
    shouldBeRejected,
    simulateTx,
    ulnPDA,
} from '../utils';
import { DST_EID, EOAPP_ULN, SRC_EID } from '../utils/constants';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const dvnSDK = new DVN(DVN_PROGRAM_ID);

    const [dvnConfigAccount] = dvnPDA.config();
    const priceFeedProgramId = priceFeedPda.program;

    const [msglib] = ulnPDA.messageLib();

    const quoteAccounts: { priceFeedProgram: PublicKey } = {
        priceFeedProgram: priceFeedProgramId,
    };

    const quoteParams: QuoteDvnInstructionArgs = {
        msglib,
        dstEid: DST_EID,
        sender: EOAPP_ULN.publicKey,
        packetHeader: Uint8Array.from([]),
        payloadHash: new Uint8Array(32).fill(0),
        confirmations: 0,
        options: [
            {
                optionType: 0,
                params: Uint8Array.from([]),
            },
        ],
    };

    async function setPause(pause: boolean): Promise<WrappedInstruction> {
        return (
            await dvnSDK.setMultisigConfig(
                umi.rpc,
                wallet,
                {
                    vid: SRC_EID % 30000,
                    expiration: await onChainExpiration(connection, 120),
                    config: {
                        __kind: 'Paused',
                        fields: [pause],
                    },
                },
                new DVNSigner(MAX_VERIFIER_SIGNERS),
            )
        )[0];
    }

    it('should failure when dvn config pause is true', async function () {
        const ix = dvnSDK.quoteDvn({
            ...quoteAccounts,
            ...quoteParams,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [await setPause(true), ix], wallet),
            new PausedError(dvnSDK.getProgram()),
        );
    });

    it('should failure with not exist msgLib', async function () {
        const ix = dvnSDK.quoteDvn({
            ...quoteAccounts,
            ...quoteParams,
            msglib: generateSigner({ eddsa }).publicKey,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [ix], wallet),
            new MsgLibNotAllowedError(dvnSDK.getProgram()),
        );
    });

    it('should failure with fake sender', async function () {
        const ix = dvnSDK.quoteDvn({
            ...quoteAccounts,
            ...quoteParams,
            sender: generateSigner({ eddsa }).publicKey,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, [ix], wallet),
            new PermissionDeniedError(dvnSDK.getProgram()),
        );
    });

    it('should failure with Zero dstConfig.dst_gas', async function () {
        const configIx = dvnSDK.setConfig(wallet, {
            __kind: 'DstConfigs',
            fields: [
                [
                    {
                        eid: DST_EID,
                        dstGas: 0,
                        multiplierBps: none(),
                        floorMarginUsd: none(),
                    },
                ],
            ],
        });
        // const configIx = dvnSDK.setDstConfig(wallet, )
        const quoteIx = dvnSDK.quoteDvn({
            ...quoteAccounts,
            ...quoteParams,
        });
        await shouldBeRejected(
            sendAndConfirm(umi, [configIx, quoteIx], wallet),
            new EidNotSupportedError(dvnSDK.getProgram()),
        );
    });

    it('should failure if sender is in denylist', async function () {
        const [denyIx] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            {
                vid: SRC_EID % 30000,
                expiration: await onChainExpiration(connection, 120),
                config: {
                    __kind: 'Denylist',
                    fields: [[EOAPP_ULN.publicKey]],
                },
            },
            new DVNSigner(MAX_VERIFIER_SIGNERS),
        );

        const quoteIx = dvnSDK.quoteDvn({
            ...quoteAccounts,
            ...quoteParams,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [denyIx, quoteIx], wallet),
            new PermissionDeniedError(dvnSDK.getProgram()),
        );
    });

    it('should success', async function () {
        const ix = dvnSDK.quoteDvn({
            ...quoteAccounts,
            ...quoteParams,
        });

        const fee = await simulateTx(connection, ix, wallet, u64());
        const expectedFee = await calDvnFee(validator, DST_EID);
        assert.strictEqual(fee, expectedFee);
    });

    it('should success with any sender if allowlist is empty', async function () {
        const config = await accounts.fetchDvnConfig(umi, dvnConfigAccount);
        // remove all item in allowlist
        const [allowIx] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            {
                vid: SRC_EID % 30000,
                expiration: await onChainExpiration(connection, 120),
                config: {
                    __kind: 'Allowlist',
                    fields: [config.acl.allowList],
                },
            },
            new DVNSigner(MAX_VERIFIER_SIGNERS),
        );

        const ix = dvnSDK.quoteDvn({
            ...quoteAccounts,
            ...quoteParams,
        });
        const fee = await simulateTx(connection, [allowIx, ix], wallet, u64());
        const expectedFee = await calDvnFee(validator, DST_EID);
        assert.strictEqual(fee, expectedFee);
    });
};
