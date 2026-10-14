import { Signer, WrappedInstruction } from '@metaplex-foundation/umi';
import { it } from 'vitest';

import { SolanaSigner } from '@layerzerolabs/lz-corekit-solana';

import { DVN, DVN_PROGRAM_ID, errors } from '../../../src/dvn';
import { SolanaTestValidator } from '../../setup';
import {
    HACKER,
    onChainExpiration,
    revertIx,
    revertTxError,
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

    async function setPause(
        pause: boolean,
        signers: SolanaSigner[],
        singer: Signer = wallet,
        expiration?: bigint,
    ): Promise<[WrappedInstruction, Buffer]> {
        return dvnSDK.setMultisigConfig(
            umi.rpc,
            singer,
            {
                vid: SRC_EID % 30000,
                expiration: expiration ?? (await onChainExpiration(connection, 120)),
                config: {
                    __kind: 'Paused',
                    fields: [pause],
                },
            },
            new DVNSigner(signers),
        );
    }

    async function setQuorum(
        quorum: number,
        signers: SolanaSigner[],
        singer: Signer = wallet,
        expiration?: bigint,
    ): Promise<[WrappedInstruction, Buffer]> {
        return dvnSDK.setMultisigConfig(
            umi.rpc,
            singer,
            {
                vid: SRC_EID % 30000,
                expiration: expiration ?? (await onChainExpiration(connection, 120)),
                config: {
                    __kind: 'Quorum',
                    fields: [quorum],
                },
            },
            new DVNSigner(signers),
        );
    }

    it('should failure if not sign by admin when invoke non-set-admin instruction', async () => {
        await shouldBeRejected(
            sendAndConfirm(
                umi,
                (await setPause(false, [VERIFIER_SIGNER1, VERIFIER_SIGNER2], HACKER))[0],
                HACKER,
            ), // pass two hacker signer to force override the instruction signer
            new errors.NotAdminError(dvnSDK.getProgram()),
        );
    });

    it('should failure without signers', async function () {
        await shouldBeRejected(
            sendAndConfirm(umi, (await setPause(false, []))[0], wallet),
            new errors.InvalidSignatureLenError(dvnSDK.getProgram()),
        );
    });

    it('should failure if signers not enough', async function () {
        await shouldBeRejected(
            sendAndConfirm(
                umi,
                [
                    (await setQuorum(2, [VERIFIER_SIGNER1, VERIFIER_SIGNER2]))[0],
                    (await setPause(false, [VERIFIER_SIGNER1]))[0],
                ],
                wallet,
            ),
            new errors.InvalidSignatureLenError(dvnSDK.getProgram()),
        );
    });

    it('should failure if signers duplicate', async function () {
        // quorum is 2, try to trick the system by sending the same signer twice
        await shouldBeRejected(
            sendAndConfirm(
                umi,
                [
                    (await setQuorum(2, [VERIFIER_SIGNER1, VERIFIER_SIGNER2]))[0],
                    (await setPause(false, [VERIFIER_SIGNER1, VERIFIER_SIGNER1]))[0],
                ],
                wallet,
            ),
            new errors.DuplicateSignatureError(dvnSDK.getProgram()),
        );
    });

    it('should failure with wrong signer', async function () {
        await shouldBeRejected(
            sendAndConfirm(
                umi,
                [
                    (
                        await setPause(false, [
                            SolanaSigner.from(
                                'test test test test test test test test test test test junk',
                                "m/44'/501'/0'/20'",
                            ),
                        ])
                    )[0],
                ],
                wallet,
            ),
            new errors.SignerNotInCommitteeError(dvnSDK.getProgram()),
        );
    });

    it('should failure if replay attack', async function () {
        const [ix] = await setPause(false, [VERIFIER_SIGNER1, VERIFIER_SIGNER1]);
        await shouldBeRejected(sendAndConfirm(umi, [ix, ix], wallet), '0x0');
    });

    it('should success', async function () {
        const [ix] = await setPause(false, [VERIFIER_SIGNER1, VERIFIER_SIGNER1]);
        await shouldBeRejected(sendAndConfirm(umi, [ix, revertIx()], wallet), revertTxError());
    });

    it('should failure when quorum > signers', async function () {
        await shouldBeRejected(
            sendAndConfirm(
                umi,
                [
                    (await setQuorum(2, [VERIFIER_SIGNER1, VERIFIER_SIGNER2]))[0],
                    (await setPause(false, [VERIFIER_SIGNER1]))[0],
                ],
                wallet,
            ),
            new errors.InvalidSignatureLenError(dvnSDK.getProgram()),
        );
    });

    it('should success with quorum signers', async function () {
        await shouldBeRejected(
            sendAndConfirm(
                umi,
                [
                    (await setQuorum(1, [VERIFIER_SIGNER1, VERIFIER_SIGNER2]))[0],
                    (await setPause(false, [VERIFIER_SIGNER1]))[0],
                    revertIx(),
                ],
                wallet,
            ),
            revertTxError(),
        );
    });

    it('should success no matter who signed when invoke set-admin instruction', async () => {
        const [setAdminIx] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            {
                vid: SRC_EID % 30000,
                expiration: await onChainExpiration(connection, 120),
                config: {
                    __kind: 'Admins',
                    fields: [[wallet.publicKey]],
                },
            },
            new DVNSigner([VERIFIER_SIGNER1, VERIFIER_SIGNER2]),
        );
        await shouldBeRejected(
            sendAndConfirm(umi, [setAdminIx, revertIx()], HACKER),
            revertTxError(),
        );
    });
};
