import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { assert } from 'vitest';
import { it } from 'vitest';

import { SolanaSigner } from '@layerzerolabs/lz-corekit-solana';

import { DVNProgram, extractEventFromTransactionSignature } from '../../../src';
import { accounts, DVN, DVN_PROGRAM_ID, events } from '../../../src/dvn';
import {
    InvalidSignersLenError,
    NotAdminError,
    UniqueOwnersError,
} from '../../../src/generated/dvn';
import { SolanaTestValidator } from '../../setup';
import {
    dvnPDA,
    getECDSAPublicKeyWithoutPrefix,
    HACKER,
    MAX_VERIFIER_SIGNERS,
    maxSignerNum,
    onChainExpiration,
    sendAndConfirm,
    shouldBeRejected,
    SRC_EID,
    VERIFIER_SIGNER1,
    VERIFIER_SIGNER2,
} from '../../utils';
import { DVNSigner } from '../../utils/dvnInvoke';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const dvnSDK = new DVN(DVN_PROGRAM_ID);
    const newSigner = SolanaSigner.from(
        'test test test test test test test test test test test junk',
        "m/44'/501'/0'/15'",
    );

    const args = async (signers: Uint8Array[]) => {
        return {
            vid: SRC_EID % 30000,
            config: {
                __kind: 'Signers',
                fields: [signers],
            } satisfies DVNProgram.types.MultisigConfig,
            expiration: await onChainExpiration(connection, 120),
        };
    };

    it('should failure with invalid admins', async function () {
        const [ix] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            HACKER,
            await args([
                await getECDSAPublicKeyWithoutPrefix(VERIFIER_SIGNER1),
                await getECDSAPublicKeyWithoutPrefix(VERIFIER_SIGNER2),
                await getECDSAPublicKeyWithoutPrefix(newSigner),
            ]),
            new DVNSigner([VERIFIER_SIGNER1, VERIFIER_SIGNER2]),
        );

        await shouldBeRejected(
            sendAndConfirm(umi, ix, HACKER),
            new NotAdminError(dvnSDK.getProgram()),
        );
    });

    it('should failure with empty signers', async function () {
        const [ix] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            await args([]),
            new DVNSigner([VERIFIER_SIGNER1, VERIFIER_SIGNER2]),
        );
        await shouldBeRejected(
            sendAndConfirm(umi, ix, wallet),
            new InvalidSignersLenError(dvnSDK.getProgram()),
        );
    });

    it('should failure with too many signers', async function () {
        const [ix] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            await args([
                await getECDSAPublicKeyWithoutPrefix(VERIFIER_SIGNER1),
                ...(await Promise.all(
                    MAX_VERIFIER_SIGNERS.map(async (signer) =>
                        getECDSAPublicKeyWithoutPrefix(signer),
                    ),
                )),
            ]),
            new DVNSigner([VERIFIER_SIGNER1, VERIFIER_SIGNER2]),
        );
        await shouldBeRejected(
            sendAndConfirm(umi, ix, wallet),
            new InvalidSignersLenError(dvnSDK.getProgram()),
        );
    });

    it('should failure with duplicated signers', async function () {
        const [ix] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            await args([
                await getECDSAPublicKeyWithoutPrefix(VERIFIER_SIGNER1),
                await getECDSAPublicKeyWithoutPrefix(VERIFIER_SIGNER1),
            ]),
            new DVNSigner([VERIFIER_SIGNER1, VERIFIER_SIGNER2]),
        );
        await shouldBeRejected(
            sendAndConfirm(umi, ix, wallet),
            new UniqueOwnersError(dvnSDK.getProgram()),
        );
    });

    it('should success', async function () {
        const [configAccount] = dvnPDA.config();
        const [ix] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            await args([
                await getECDSAPublicKeyWithoutPrefix(VERIFIER_SIGNER1),
                await getECDSAPublicKeyWithoutPrefix(VERIFIER_SIGNER2),
                await getECDSAPublicKeyWithoutPrefix(newSigner),
            ]),
            new DVNSigner([VERIFIER_SIGNER1, VERIFIER_SIGNER2]),
        );
        const { signature } = await sendAndConfirm(umi, ix, wallet);
        let config = await accounts.fetchDvnConfig(umi, configAccount);
        assert.deepStrictEqual(config.multisig.signers.length, 3);
        //check events
        const txEvents = await extractEventFromTransactionSignature(
            connection,
            toWeb3JsPublicKey(dvnSDK.programId),
            signature,
            events.getMultisigConfigSetEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        if (txEvents === null) {
            throw new Error('txEvents is null');
        }
        const event: events.MultisigConfigSetEvent = txEvents[0];
        const signers = event.config.fields[0] as Uint8Array[];
        assert.strictEqual(signers.length, 3);
        assert.deepStrictEqual(signers[0], await getECDSAPublicKeyWithoutPrefix(VERIFIER_SIGNER1));
        assert.deepStrictEqual(signers[1], await getECDSAPublicKeyWithoutPrefix(VERIFIER_SIGNER2));
        assert.deepStrictEqual(signers[2], await getECDSAPublicKeyWithoutPrefix(newSigner));

        const [resetIx] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            await args(
                await Promise.all(
                    MAX_VERIFIER_SIGNERS.map(async (signer) =>
                        getECDSAPublicKeyWithoutPrefix(signer),
                    ),
                ),
            ),
            new DVNSigner([VERIFIER_SIGNER1, VERIFIER_SIGNER2, newSigner]),
        );
        await sendAndConfirm(umi, resetIx, wallet);
        config = await accounts.fetchDvnConfig(umi, configAccount);
        assert.strictEqual(config.multisig.signers.length, maxSignerNum);
    });
};
