import type { ICantonClient } from '../client/interface';
import type { CantonPopulatedTransaction } from '../transaction';

export const prepareRefreshableTransferInstructionAcceptance = async ({
    client,
    partyId,
    contractId,
    packageVettingParties = [partyId],
}: {
    client: ICantonClient;
    partyId: string;
    contractId: string;
    packageVettingParties?: string[];
}): Promise<CantonPopulatedTransaction> => {
    const [packageId, bundle] = await Promise.all([
        client.getPackageId('splice-api-token-transfer-instruction-v1', packageVettingParties),
        client.getTransferInstructionAcceptContext({ contractId }),
    ]);
    return {
        actAs: [partyId],
        unresolvedCommands: [
            {
                exerciseCommand: {
                    templateId: `${packageId}:Splice.Api.Token.TransferInstructionV1:TransferInstruction`,
                    contractId,
                    choice: 'TransferInstruction_Accept',
                    choiceArgument: {
                        extraArgs: { context: bundle.choiceContext, meta: { values: {} } },
                    },
                },
            },
        ],
        unresolvedDisclosedContracts: bundle.disclosedContracts,
        refreshPlan: {
            commands: [
                {
                    resolver: { type: 'transferInstructionAcceptContext', contractId },
                    targets: [
                        {
                            commandIndex: 0,
                            command: 'exercise',
                            choice: 'TransferInstruction_Accept',
                            arguments: [{ path: [{ field: 'extraArgs' }, { field: 'context' }] }],
                        },
                    ],
                },
            ],
        },
    };
};
