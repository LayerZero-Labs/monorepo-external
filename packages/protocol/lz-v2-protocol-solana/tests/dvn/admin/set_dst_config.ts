import { none, some } from '@metaplex-foundation/umi';
import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import BN from 'bn.js';
import { assert } from 'vitest';
import { it } from 'vitest';

import { extractEventFromTransactionSignature } from '../../../src';
import { accounts, DVN, DVN_PROGRAM_ID, events, types } from '../../../src/dvn';
import { NotAdminError } from '../../../src/generated/dvn';
import { SolanaTestValidator } from '../../setup';
import {
    dvnPDA,
    generateDstConfigs,
    maxDstConfigsLen,
    maxOptionTypeNum,
    sendAndConfirm,
    shouldBeRejected,
    splitArrayIntoChunks,
} from '../../utils';
import { DST_EID, HACKER } from '../../utils/constants';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const dvnSDK = new DVN(DVN_PROGRAM_ID);

    const [configAccount] = dvnPDA.config();
    const optionTypes = [1]; // TODO: fill in the option types
    for (let i = optionTypes.length; i < maxOptionTypeNum; i++) {
        optionTypes.push(0);
    }
    const dstConfig: types.DstConfig = {
        eid: DST_EID,
        dstGas: 10000,
        multiplierBps: some(12000),
        floorMarginUsd: none(),
    };

    it('should failure with invalid admin', async function () {
        const ix = dvnSDK.setConfig(HACKER, {
            fields: [[dstConfig]],
            __kind: 'DstConfigs',
        });
        await shouldBeRejected(
            sendAndConfirm(umi, [ix], HACKER),
            new NotAdminError(dvnSDK.getProgram()),
        );
    });

    it('should success', async function () {
        const ix = dvnSDK.setConfig(wallet, {
            fields: [[dstConfig]],
            __kind: 'DstConfigs',
        });
        const { signature } = await sendAndConfirm(umi, [ix], wallet);
        const config = await accounts.fetchDvnConfig(umi, configAccount);
        assert.deepStrictEqual(
            {
                eid: config.dstConfigs[0].eid,
                dstGas: new BN(config.dstConfigs[0].dstGas).toNumber(),
                multiplierBps: config.dstConfigs[0].multiplierBps,
                floorMarginUsd: config.dstConfigs[0].floorMarginUsd,
            },
            dstConfig,
        );
        await setMultiDstConfigs([dstConfig]);
        //check events

        const txEvents = await extractEventFromTransactionSignature(
            connection,
            toWeb3JsPublicKey(dvnSDK.programId),
            signature,
            events.getAdminConfigSetEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );

        if (txEvents === null) {
            throw new Error('txEvents is null');
        }
        const event: events.AdminConfigSetEvent = txEvents[0];
        const dstConfigs = event.config.fields[0] as types.DstConfig[];
        assert.deepStrictEqual(
            {
                eid: dstConfigs[0].eid,
                dstGas: new BN(dstConfigs[0].dstGas).toNumber(),
                multiplierBps: dstConfigs[0].multiplierBps,
                floorMarginUsd: dstConfigs[0].floorMarginUsd,
            },
            dstConfig,
        );
    });

    it('should success with updated dstConfig', async function () {
        dstConfig.multiplierBps = some(13000);
        await setMultiDstConfigs([dstConfig]);
    });

    it('should success with multiple dstConfigs', async function () {
        const configSize = 4;
        const configs = generateDstConfigs(configSize);
        await setMultiDstConfigs(configs);
    });

    it('should success with multiple updated dstConfigs', async function () {
        const configSize = 4;
        const configs = generateDstConfigs(configSize);
        for (let i = 0; i < configSize; i++) {
            configs[i].multiplierBps = some(13000);
        }
        await setMultiDstConfigs(configs);
    });

    it('should success with max multiple dstConfigs', async function () {
        const configs = generateDstConfigs(maxDstConfigsLen);
        const arraySplits: types.DstConfig[][] = splitArrayIntoChunks(
            configs,
            maxDstConfigsLen / 10,
        );
        await Promise.all(
            arraySplits.map(async (split): Promise<void> => {
                const ix = dvnSDK.setConfig(wallet, {
                    fields: [split],
                    __kind: 'DstConfigs',
                });
                await sendAndConfirm(umi, [ix], wallet);
            }),
        );
    });

    async function setMultiDstConfigs(configs: types.DstConfig[]): Promise<void> {
        const ix = dvnSDK.setConfig(wallet, {
            fields: [configs],
            __kind: 'DstConfigs',
        });
        await sendAndConfirm(umi, [ix], wallet);
        const config = await accounts.fetchDvnConfig(umi, configAccount);
        for (let i = 0; i < configs.length; i++) {
            assert.deepStrictEqual(
                {
                    eid: config.dstConfigs[i].eid,
                    dstGas: new BN(config.dstConfigs[i].dstGas).toNumber(),
                    multiplierBps: config.dstConfigs[i].multiplierBps,
                    floorMarginUsd: config.dstConfigs[i].floorMarginUsd,
                },
                configs[i],
            );
        }
    }
};
