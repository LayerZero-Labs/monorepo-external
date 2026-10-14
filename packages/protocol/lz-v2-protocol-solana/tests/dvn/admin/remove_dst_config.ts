import { none, some } from '@metaplex-foundation/umi';
import BN from 'bn.js';
import { assert } from 'vitest';
import { it } from 'vitest';

import { DVNProgram } from '../../../src';
import { accounts, DVN, errors, types } from '../../../src/dvn';
import { SolanaTestValidator } from '../../setup';
import { dvnPDA, HACKER, sendAndConfirm, shouldBeRejected } from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const wallet = umi.payer;
    const dvnSDK = new DVN(DVNProgram.DVN_PROGRAM_ID);

    const [configAccount] = dvnPDA.config();
    const dstConfigs: types.DstConfig[] = [
        {
            eid: 666,
            dstGas: 666,
            multiplierBps: some(666),
            floorMarginUsd: none(),
        },
        {
            eid: 667,
            dstGas: 667,
            multiplierBps: some(667),
            floorMarginUsd: none(),
        },
        {
            eid: 668,
            dstGas: 668,
            multiplierBps: some(668),
            floorMarginUsd: none(),
        },
    ];

    it('should failure with invalid admin', async function () {
        const ix = dvnSDK.setConfig(HACKER, {
            fields: [[7, 8, 9]],
            __kind: 'RemoveDstConfigs',
        });
        await shouldBeRejected(
            sendAndConfirm(umi, ix, HACKER),
            new errors.NotAdminError(dvnSDK.getProgram()),
        );
    });

    it('should remove successfully', async function () {
        const ix = dvnSDK.setConfig(wallet, {
            fields: [dstConfigs],
            __kind: 'DstConfigs',
        });

        await sendAndConfirm(umi, ix, wallet);
        let config = await accounts.fetchDvnConfig(umi, configAccount);
        for (let i = 0; i < dstConfigs.length; i++) {
            assert.deepStrictEqual(
                {
                    eid: config.dstConfigs[i].eid,
                    dstGas: new BN(config.dstConfigs[i].dstGas).toNumber(),
                    multiplierBps: config.dstConfigs[i].multiplierBps,
                    floorMarginUsd: config.dstConfigs[i].floorMarginUsd,
                },
                dstConfigs[i],
            );
        }

        // remove the first one config
        const removeEids = [dstConfigs[0].eid];
        const removeIx = dvnSDK.setConfig(wallet, {
            fields: [removeEids],
            __kind: 'RemoveDstConfigs',
        });
        await sendAndConfirm(umi, removeIx, wallet);
        config = await accounts.fetchDvnConfig(umi, configAccount);
        for (let i = 0; i < dstConfigs.length - 1; i++) {
            assert.deepStrictEqual(
                {
                    eid: config.dstConfigs[i].eid,
                    dstGas: new BN(config.dstConfigs[i].dstGas).toNumber(),
                    multiplierBps: config.dstConfigs[i].multiplierBps,
                    floorMarginUsd: config.dstConfigs[i].floorMarginUsd,
                },
                dstConfigs[i + 1],
            );
        }

        // remove the rest
        const removeEids2 = [dstConfigs[1].eid, dstConfigs[2].eid];
        const removeIx2 = dvnSDK.setConfig(wallet, {
            fields: [removeEids2],
            __kind: 'RemoveDstConfigs',
        });
        await sendAndConfirm(umi, removeIx2, wallet);
        config = await accounts.fetchDvnConfig(umi, configAccount);
        assert.deepStrictEqual(config.dstConfigs, []);
    });
};
