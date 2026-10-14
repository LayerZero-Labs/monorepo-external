import { isSome, PublicKey, some } from '@metaplex-foundation/umi';
import { fromWeb3JsPublicKey, toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import invariant from 'tiny-invariant';
import { assert, beforeAll as before, it } from 'vitest';

import { extractEventFromTransactionSignature } from '../../../src';
import { accounts, errors, events, Uln, ULN_PROGRAM_ID } from '../../../src/uln';
import { SolanaTestValidator } from '../../setup';
import {
    bpsDenominator,
    defaultNativeFeeBps,
    defaultTreasuryFee,
    getAssociatedLzTokenAddress,
    sendAndConfirm,
    shouldBeRejected,
} from '../../utils';
import { HACKER, TREASURER, ulnPDA } from '../../utils/constants';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const ulnSDK = new Uln(ULN_PROGRAM_ID);

    const [ulnSettingAccount] = ulnPDA.setting();
    const receiver = TREASURER;
    let lzTokenTreasury: PublicKey;

    before(async function () {
        lzTokenTreasury = fromWeb3JsPublicKey(
            await getAssociatedLzTokenAddress(toWeb3JsPublicKey(TREASURER.publicKey)),
        );
    });

    it('should failure with invalid admin', async function () {
        const ix = ulnSDK.setTreasury(HACKER, {
            admin: HACKER.publicKey,
            nativeReceiver: receiver.publicKey,
            nativeFeeBps: defaultNativeFeeBps,
            lzToken: {
                receiver: lzTokenTreasury,
                fee: Number(defaultTreasuryFee),
            },
        });
        await shouldBeRejected(
            sendAndConfirm(umi, ix, HACKER),
            new errors.UnauthorizedError(ulnSDK.getProgram()),
        );
    });

    it('should failure with large native fee bps', async function () {
        const ix = ulnSDK.setTreasury(wallet, {
            admin: wallet.publicKey,
            nativeReceiver: receiver.publicKey,
            nativeFeeBps: bpsDenominator + 1,
            lzToken: {
                receiver: lzTokenTreasury,
                fee: Number(defaultTreasuryFee),
            },
        });

        await shouldBeRejected(
            sendAndConfirm(umi, ix, wallet),
            new errors.InvalidBpsError(ulnSDK.getProgram()),
        );
    });

    it('should success', async function () {
        const ix = ulnSDK.setTreasury(wallet, {
            admin: wallet.publicKey,
            nativeReceiver: receiver.publicKey,
            nativeFeeBps: defaultNativeFeeBps,
            lzToken: {
                receiver: lzTokenTreasury,
                fee: Number(defaultTreasuryFee),
            },
        });

        const { signature } = await sendAndConfirm(umi, ix, wallet);
        const ulnSetting = await accounts.fetchUlnSettings(umi, ulnSettingAccount);
        invariant(isSome(ulnSetting.treasury), 'ulnSetting treasury is not defined');
        assert.deepStrictEqual(ulnSetting.treasury.value.admin, some(wallet.publicKey));
        assert.strictEqual(ulnSetting.treasury.value.nativeReceiver, receiver.publicKey);
        assert.strictEqual(ulnSetting.treasury.value.nativeFeeBps, BigInt(defaultNativeFeeBps));
        invariant(
            isSome(ulnSetting.treasury.value.lzToken),
            'ulnSetting treasury lzToken is undefined',
        );
        assert.strictEqual(ulnSetting.treasury.value.lzToken.value.receiver, lzTokenTreasury);
        assert.strictEqual(ulnSetting.treasury.value.lzToken.value.fee, BigInt(defaultTreasuryFee));
        //check events
        const txEvents = await extractEventFromTransactionSignature(
            connection,
            toWeb3JsPublicKey(ulnSDK.programId),
            signature,
            events.getTreasurySetEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );

        if (txEvents === null) {
            throw new Error('txEvents is null');
        }
        const event: events.TreasurySetEvent = txEvents[0];
        invariant(isSome(event.treasury), 'event treasury is not defined');
        assert.deepStrictEqual(event.treasury.value.admin, some(wallet.publicKey));
        assert.strictEqual(event.treasury.value.nativeReceiver, receiver.publicKey);
        assert.strictEqual(event.treasury.value.nativeFeeBps, BigInt(defaultNativeFeeBps));
        invariant(isSome(event.treasury.value.lzToken), 'event treasury lzToken is undefined');
        assert.strictEqual(event.treasury.value.lzToken.value.receiver, lzTokenTreasury);
        assert.strictEqual(event.treasury.value.lzToken.value.fee, BigInt(defaultTreasuryFee));
    });
};
