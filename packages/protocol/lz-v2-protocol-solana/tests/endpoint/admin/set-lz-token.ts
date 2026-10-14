import { none, unwrapOption } from '@metaplex-foundation/umi';
import { fromWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { assert, it } from 'vitest';

import { EndpointProgram, extractEventFromTransactionSignature } from '../../../src';
import { SolanaTestValidator } from '../../setup';
import {
    ConstraintHasOne,
    endpointPDA,
    getFakeLzTokenMint,
    getLzTokenMint,
    HACKER,
    sendAndConfirm,
    shouldBeRejected,
} from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);

    // PDAs
    const [endpoint] = endpointPDA.setting();

    it('revert if not admin', async function () {
        const lzTokenMint = getLzTokenMint();
        const ix = endpointSDK.setLzToken(HACKER, fromWeb3JsPublicKey(lzTokenMint));
        await shouldBeRejected(sendAndConfirm(umi, [ix], HACKER), ConstraintHasOne);
    });

    it('success set lz token to null', async function () {
        const setToFakeLzTokenIx = endpointSDK.setLzToken(
            wallet,
            fromWeb3JsPublicKey(getFakeLzTokenMint()),
        );

        const setToNullIx = endpointSDK.setLzToken(wallet, null);

        const { signature } = await sendAndConfirm(umi, [setToFakeLzTokenIx, setToNullIx], wallet);

        // Check
        const endpointSettings = await EndpointProgram.accounts.fetchEndpointSettings(
            umi,
            endpoint,
        );
        assert.strictEqual(endpointSettings.lzTokenMint.__option, none().__option);

        // check event
        const events = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getLzTokenSetEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        assert.strictEqual(events?.length, 2);
        assert.strictEqual(unwrapOption(events?.[0].token!), getFakeLzTokenMint().toBase58());
        assert.strictEqual(events?.[1].token.__option, none().__option);
    });

    it('success set lz-token', async function () {
        const lzTokenMint = getLzTokenMint();
        const ix = endpointSDK.setLzToken(wallet, fromWeb3JsPublicKey(lzTokenMint));
        const { signature } = await sendAndConfirm(umi, [ix], wallet);

        // Check
        const endpointSettings = await EndpointProgram.accounts.fetchEndpointSettings(
            umi,
            endpoint,
        );
        assert.strictEqual(endpointSettings.lzTokenMint.__option, 'Some');
        assert.strictEqual(unwrapOption(endpointSettings.lzTokenMint), lzTokenMint.toBase58());

        // check event
        const events = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getLzTokenSetEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        assert.strictEqual(events?.length, 1);
        assert.strictEqual(unwrapOption(events?.[0].token!), lzTokenMint.toBase58());
    });
};
