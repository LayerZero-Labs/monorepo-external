import { assert } from 'vitest';
import { beforeAll as before, it } from 'vitest';

import { accounts, DVN, DVN_PROGRAM_ID } from '../../src/dvn';
import {
    InvalidQuorumError,
    InvalidSignersLenError,
    TooManyAdminsError,
    UniqueOwnersError,
} from '../../src/generated/dvn';
import { SolanaTestValidator } from '../setup';
import {
    dvnPDA,
    generateMaxAdmin,
    generateMaxSigner,
    getECDSAPublicKeyWithoutPrefix,
    priceFeedPda,
    sendAndConfirm,
    shouldBeRejected,
    SRC_EID,
    ulnPDA,
    VERIFIER_SIGNER1,
    VERIFIER_SIGNER2,
} from '../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi } = validator;
    const wallet = umi.payer;
    const dvnSDK = new DVN(DVN_PROGRAM_ID);

    const [configAccount, bump] = dvnPDA.config();
    const [msglib] = ulnPDA.messageLib();
    const [priceFeed] = priceFeedPda.priceFeed();
    const quorum = 1;
    const signers: Uint8Array[] = [];

    before(async function () {
        signers.push(await getECDSAPublicKeyWithoutPrefix(VERIFIER_SIGNER1));
        signers.push(await getECDSAPublicKeyWithoutPrefix(VERIFIER_SIGNER2));
    });

    it('should failure with zero quorum', async function () {
        const ix = await dvnSDK.initDVN(umi.rpc, wallet, {
            admins: [wallet.publicKey],
            signers: signers,
            msglibs: [msglib],
            quorum: 0,
            vid: SRC_EID % 30000,
            priceFeed: priceFeed,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [ix], wallet),
            new InvalidQuorumError(dvnSDK.getProgram()),
        );
    });

    it('should failure with params.quorum greater than config verifiers num', async function () {
        const ix = await dvnSDK.initDVN(umi.rpc, wallet, {
            admins: [wallet.publicKey],
            signers: signers,
            msglibs: [msglib],
            quorum: quorum + signers.length,
            vid: SRC_EID % 30000,
            priceFeed: priceFeed,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [ix], wallet),
            new InvalidQuorumError(dvnSDK.getProgram()),
        );
    });

    it('should failure with non unique signer', async function () {
        const ix = await dvnSDK.initDVN(umi.rpc, wallet, {
            admins: [wallet.publicKey],
            signers: [signers[0], signers[0]],
            msglibs: [msglib],
            quorum: quorum,
            vid: SRC_EID % 30000,
            priceFeed: priceFeed,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [ix], wallet),
            new UniqueOwnersError(dvnSDK.getProgram()),
        );
    });

    it('should failure with too many admins', async function () {
        const ix = await dvnSDK.initDVN(umi.rpc, wallet, {
            admins: [wallet.publicKey, ...generateMaxAdmin()],
            signers: signers,
            msglibs: [msglib],
            quorum,
            vid: SRC_EID % 30000,
            priceFeed: priceFeed,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [ix], wallet),
            new TooManyAdminsError(dvnSDK.getProgram()),
        );
    });

    it('should failure with too many signers', async function () {
        const ix = await dvnSDK.initDVN(umi.rpc, wallet, {
            admins: [wallet.publicKey],
            signers: [signers[0], ...(await generateMaxSigner())],
            msglibs: [msglib],
            quorum,
            vid: SRC_EID % 30000,
            priceFeed: priceFeed,
        });

        await shouldBeRejected(
            sendAndConfirm(umi, [ix], wallet),
            new InvalidSignersLenError(dvnSDK.getProgram()),
        );
    });

    it('should success', async function () {
        const ix = await dvnSDK.initDVN(umi.rpc, wallet, {
            admins: [wallet.publicKey],
            signers: signers,
            msglibs: [msglib],
            quorum,
            vid: SRC_EID % 30000,
            priceFeed: priceFeed,
        });

        await sendAndConfirm(umi, [ix], wallet);
        const config = await accounts.fetchDvnConfig(umi, configAccount);
        assert.strictEqual(config.admins[0], wallet.publicKey);
        assert.deepStrictEqual(
            config.multisig.signers[0],
            await getECDSAPublicKeyWithoutPrefix(VERIFIER_SIGNER1),
        );
        assert.deepStrictEqual(
            config.multisig.signers[1],
            await getECDSAPublicKeyWithoutPrefix(VERIFIER_SIGNER2),
        );
        assert.strictEqual(config.msglibs[0], msglib);
        assert.strictEqual(config.multisig.quorum, quorum);
        assert.strictEqual(config.bump, bump);
    });
};
