import { WrappedInstruction } from '@metaplex-foundation/umi';
import { assert, it } from 'vitest';

import { EndpointProgram, extractEventFromTransactionSignature } from '../../../src';
import { getSetDelegateInstructionDataSerializer } from '../../../src/generated/endpoint';
import { SolanaTestValidator } from '../../setup';
import { endpointPDA, EOAPP, EOAPP_DELEGATE, HACKER } from '../../utils/constants';
import { sendAndConfirm } from '../../utils/util';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    const oAppKp = EOAPP;

    // PDAs
    const [oappRegistryPda] = endpointPDA.oappRegistry(oAppKp.publicKey);

    it('should success', async function () {
        const keys = endpointSDK.getSetDelegateIxAccountMetaForCPI(oAppKp.publicKey).slice(1);
        keys[0].isSigner = true;
        const ix = {
            instruction: {
                keys: keys,
                data: getSetDelegateInstructionDataSerializer().serialize({
                    delegate: HACKER.publicKey,
                }),
                programId: endpointSDK.programId,
            },
            signers: [wallet, oAppKp],
            bytesCreatedOnChain: 0,
        } satisfies WrappedInstruction;
        await sendAndConfirm(umi, ix, wallet);

        // check
        let registerConfig = await EndpointProgram.accounts.fetchOAppRegistry(umi, oappRegistryPda);
        assert.strictEqual(registerConfig.delegate, HACKER.publicKey);

        const resetKeys = endpointSDK.getSetDelegateIxAccountMetaForCPI(oAppKp.publicKey).slice(1);
        resetKeys[0].isSigner = true;
        const resetIx = {
            instruction: {
                keys: resetKeys,
                data: getSetDelegateInstructionDataSerializer().serialize({
                    delegate: EOAPP_DELEGATE.publicKey,
                }),
                programId: endpointSDK.programId,
            },
            signers: [wallet, oAppKp],
            bytesCreatedOnChain: 0,
        };
        const { signature } = await sendAndConfirm(umi, resetIx, wallet);

        registerConfig = await EndpointProgram.accounts.fetchOAppRegistry(umi, oappRegistryPda);
        assert.strictEqual(registerConfig.delegate, EOAPP_DELEGATE.publicKey);
        // Check event
        const events = await extractEventFromTransactionSignature(
            connection,
            endpointSDK.programId,
            signature,
            EndpointProgram.events.getDelegateSetEventSerializer(),
            { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
        );
        if (events === null) {
            throw new Error('events is null');
        }
        assert.strictEqual(events[0].newDelegate, EOAPP_DELEGATE.publicKey);
    });
};
