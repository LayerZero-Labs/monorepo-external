import { PublicKey } from '@metaplex-foundation/umi';
import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { assert } from 'vitest';
import { it } from 'vitest';

import { DVNProgram, extractEventFromTransactionSignature } from '../../../src';
import { accounts, DVN, DVN_PROGRAM_ID, events } from '../../../src/dvn';
import { NotAdminError } from '../../../src/generated/dvn';
import { InvalidSizeError } from '../../../src/generated/worker_interface';
import { SolanaTestValidator } from '../../setup';
import {
    dvnPDA,
    generatePublicKeys,
    HACKER,
    MAX_VERIFIER_SIGNERS,
    maxDenyListNum,
    onChainExpiration,
    onChainUnixTimestamp,
    sendAndConfirm,
    shouldBeRejected,
    VERIFIER_SIGNER1,
    VERIFIER_SIGNER2,
} from '../../utils';
import { EOAPP, SRC_EID } from '../../utils/constants';
import { DVNSigner } from '../../utils/dvnInvoke';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const dvnSDK = new DVN(DVN_PROGRAM_ID);

    const args = {
        vid: SRC_EID % 30000,
        config: {
            __kind: 'Denylist',
            fields: [[EOAPP.publicKey]],
        } satisfies DVNProgram.types.MultisigConfig,
    };

    it('should failure with invalid admins', async function () {
        const [ix] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            HACKER,
            { ...args, expiration: await onChainExpiration(connection, 120) },
            new DVNSigner([VERIFIER_SIGNER1, VERIFIER_SIGNER2]),
        );
        await shouldBeRejected(
            sendAndConfirm(umi, ix, HACKER),
            new NotAdminError(dvnSDK.getProgram()),
        );
    });

    it('should failure with too large deny list', async function () {
        const keys = generatePublicKeys(maxDenyListNum);
        const baseTime = Number(await onChainUnixTimestamp(connection));

        // add these keys to deny list first, to trigger the InvalidSizeError
        for (let i = 0; i < maxDenyListNum / 5; i++) {
            const [ix] = await dvnSDK.setMultisigConfig(
                umi.rpc,
                wallet,
                {
                    ...args,
                    // Use unique expiration for each iteration to avoid execute_hash collisions
                    expiration: BigInt(baseTime + 120 + i),
                    config: {
                        __kind: 'Denylist',
                        fields: [keys.slice(i * 5, (i + 1) * 5)],
                    },
                },
                new DVNSigner([VERIFIER_SIGNER1, VERIFIER_SIGNER2]),
            );

            if (i === maxDenyListNum / 5) {
                await shouldBeRejected(
                    sendAndConfirm(umi, ix, wallet),
                    new InvalidSizeError(dvnSDK.getProgram()),
                );
            } else {
                await sendAndConfirm(umi, ix, wallet);
            }
        }
        // add these keys again to remove them from deny lists
        for (let i = 0; i < maxDenyListNum / 5; i++) {
            const [ix] = await dvnSDK.setMultisigConfig(
                umi.rpc,
                wallet,
                {
                    ...args,
                    // Use different expiration range to avoid using same execute_hash as first loop
                    expiration: BigInt(baseTime + 200 + i),
                    config: {
                        __kind: 'Denylist',
                        fields: [keys.slice(i * 5, (i + 1) * 5)],
                    },
                },
                new DVNSigner([VERIFIER_SIGNER1, VERIFIER_SIGNER2]),
            );
            if (i === maxDenyListNum / 5) {
                break;
            } else {
                await sendAndConfirm(umi, ix, wallet);
            }
        }
    });

    it('should success', async function () {
        const [configAccount] = dvnPDA.config();
        const [ix] = await dvnSDK.setMultisigConfig(
            umi.rpc,
            wallet,
            { ...args, expiration: await onChainExpiration(connection, 120) },
            new DVNSigner(MAX_VERIFIER_SIGNERS),
        );
        const { signature } = await sendAndConfirm(umi, ix, wallet);
        const config = await accounts.fetchDvnConfig(umi, configAccount);
        assert.strictEqual(config.acl.denyList[0], EOAPP.publicKey);
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
        const keys = event.config.fields[0] as PublicKey[];
        assert.strictEqual(keys[0], EOAPP.publicKey);
    });
};
