import { it } from 'vitest';

import { DVN, DVN_PROGRAM_ID } from '../../../src/dvn';
import { ExpiredError, InvalidVidError } from '../../../src/generated/dvn';
import { SolanaTestValidator } from '../../setup';
import {
    DVNSigner,
    onChainExpiration,
    sendAndConfirm,
    shouldBeRejected,
    SRC_EID,
    VERIFIER_SIGNER1,
    VERIFIER_SIGNER2,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const dvnSDK = new DVN(DVN_PROGRAM_ID);
    // const ix = dvnSDK.setPause(true)

    it('should failure with invalid dvn vid', async function () {
        const fakeEid = 3;
        const [ix] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            {
                vid: fakeEid,
                expiration: await onChainExpiration(connection, 120),
                config: {
                    __kind: 'Paused',
                    fields: [true],
                },
            },
            new DVNSigner([VERIFIER_SIGNER1, VERIFIER_SIGNER2]),
        );
        await shouldBeRejected(
            sendAndConfirm(umi, ix, wallet),
            new InvalidVidError(dvnSDK.getProgram()),
        );
    });

    it('should failure with expired expiration', async function () {
        const [ix] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            {
                vid: SRC_EID % 30000,
                expiration: await onChainExpiration(connection, -120),
                config: {
                    __kind: 'Paused',
                    fields: [true],
                },
            },
            new DVNSigner([VERIFIER_SIGNER1, VERIFIER_SIGNER2]),
        );

        await shouldBeRejected(
            sendAndConfirm(umi, ix, wallet),
            new ExpiredError(dvnSDK.getProgram()),
        );
    });
};
