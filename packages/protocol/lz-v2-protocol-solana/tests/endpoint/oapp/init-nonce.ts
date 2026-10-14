import { publicKeyBytes } from '@metaplex-foundation/umi';
import { assert, it } from 'vitest';

import { EndpointProgram } from '../../../src';
import { accounts } from '../../../src/endpoint';
import { SolanaTestValidator } from '../../setup';
import {
    ConstraintHasOne,
    DST_EID,
    EOAPP,
    EOAPP_DELEGATE,
    HACKER,
    sendAndConfirm,
    shouldBeRejected,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    const oAppKp = EOAPP;
    const oAppDelegateKp = EOAPP_DELEGATE;

    it('revert if not delegate', async function () {
        const ix = endpointSDK.initOAppNonce(HACKER, {
            localOApp: oAppKp.publicKey,
            remote: DST_EID,
            remoteOApp: publicKeyBytes(oAppKp.publicKey),
        });

        await shouldBeRejected(sendAndConfirm(umi, ix, HACKER), ConstraintHasOne);
    });

    it('should success', async function () {
        // PDAs
        const [nonce, nonceBump] = endpointSDK.pda.nonce(
            oAppKp.publicKey,
            DST_EID,
            publicKeyBytes(oAppKp.publicKey),
        );
        const [pendingNonce, pendingNonceBump] = endpointSDK.pda.pendingNonce(
            oAppKp.publicKey,
            DST_EID,
            publicKeyBytes(oAppKp.publicKey),
        );
        const ix = endpointSDK.initOAppNonce(oAppDelegateKp, {
            localOApp: oAppKp.publicKey,
            remote: DST_EID,
            remoteOApp: publicKeyBytes(oAppKp.publicKey),
        });
        await sendAndConfirm(umi, ix, oAppDelegateKp);

        // check accounts initialized
        const nonceState = await accounts.fetchNonce(umi, nonce);
        assert.strictEqual(nonceState.bump, nonceBump);

        const pendingNonceState = await accounts.fetchPendingInboundNonce(umi, pendingNonce);
        assert.strictEqual(pendingNonceState.bump, pendingNonceBump);
    });
};
