import { WrappedInstruction } from '@metaplex-foundation/umi';
import { assert, it } from 'vitest';

import { EndpointProgram, extractEventFromTransactionSignature } from '../../../src';
import { getRegisterOappInstructionDataSerializer } from '../../../src/generated/endpoint';
import { SolanaTestValidator } from '../../setup';
import { EOAPP_DELEGATE, EOAPP_ULN, sendAndConfirm } from '../../utils';

export const testSuite = (validator: SolanaTestValidator): void => {
    const { umi, connection } = validator;
    const wallet = umi.payer;
    const endpointSDK = new EndpointProgram.Endpoint(EndpointProgram.ENDPOINT_PROGRAM_ID);
    const oAppKp = EOAPP_ULN;
    const delegate = EOAPP_DELEGATE;

    it('should success', async function () {
        const app = oAppKp;
        const accounts = endpointSDK
            .getRegisterOappIxAccountMetaForCPI(wallet.publicKey, app.publicKey)
            .slice(1);
        accounts[0].isSigner = true; // payer
        accounts[1].isSigner = true; // delegate
        const ix = {
            instruction: {
                keys: accounts,
                data: getRegisterOappInstructionDataSerializer().serialize({
                    delegate: delegate.publicKey,
                }),
                programId: endpointSDK.programId,
            },
            signers: [wallet, app],
            bytesCreatedOnChain: 0,
        } satisfies WrappedInstruction;
        const { signature } = await sendAndConfirm(umi, ix, wallet);

        // check
        const [oappRegistryPda] = endpointSDK.pda.oappRegistry(app.publicKey);
        const registerConfig = await EndpointProgram.accounts.fetchOAppRegistry(
            umi,
            oappRegistryPda,
        );
        assert.strictEqual(registerConfig.delegate, delegate.publicKey);

        // check event
        const event =
            await extractEventFromTransactionSignature<EndpointProgram.events.OAppRegisteredEvent>(
                connection,
                endpointSDK.programId,
                signature,
                EndpointProgram.events.getOAppRegisteredEventSerializer(),
                { commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
            );
        if (event === null) {
            throw new Error('event is null');
        }
        assert.strictEqual(event[0].oapp, app.publicKey);
        assert.strictEqual(event[0].delegate, delegate.publicKey);
    });
};
