import type { InstrumentId } from '../client/amulet';
import type { CantonSdk } from '../sdk';
import type { CantonDisclosedContract } from '../transaction';
import { callbackDisclosure, callbackInterfaceView } from './callback-contracts';
import {
    fetchCallbackTransferFactoryContext,
    withCantonCallbackRegistry,
} from './callback-registry';
import {
    callbackHoldingAmount,
    discloseUtilityCredentials,
    fetchCallbackHoldings,
} from './registry-context';
import { selectLargestContracts } from './select-contracts';

const HOLDING_INTERFACE = '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding';

export const resolveLockUnlockCallbackContext = async ({
    sdk,
    informee,
    appUid,
    treasury,
    instrumentId,
    offset,
    receivers,
    environment,
}: {
    sdk: CantonSdk;
    informee: string;
    appUid: string;
    treasury: string;
    instrumentId: InstrumentId;
    offset: number;
    receivers: string[];
    environment?: string;
}): Promise<{
    disclosedContracts: CantonDisclosedContract[];
    treasuryAssetCids: string[];
    transferFactoryCid?: string;
    assetTransferContext?: Record<string, unknown>;
}> => {
    const holdings = selectLargestContracts(
        await fetchCallbackHoldings(sdk, treasury, offset, instrumentId),
        callbackHoldingAmount,
    );
    const treasuryAssetCids = holdings.map((holding) => holding.createdEvent.contractId);
    const treasuryDisclosures = holdings.map(callbackDisclosure);
    if (receivers.length === 0)
        return { disclosedContracts: treasuryDisclosures, treasuryAssetCids };

    const firstHoldingAmount = holdings
        .map((holding) => callbackInterfaceView(holding, HOLDING_INTERFACE)?.amount)
        .find((amount): amount is string => amount != null && amount !== '0');
    const { factoryId, choiceContext, disclosedContracts, credentialDisclosures } =
        await withCantonCallbackRegistry(
            { sdk, informee, offset, appUid, instrumentId, environment },
            async (registry) => {
                const context = await fetchCallbackTransferFactoryContext(
                    registry,
                    sdk,
                    instrumentId,
                    {
                        environment,
                        inputHoldingCids: treasuryAssetCids,
                        sender: treasury,
                        amount: firstHoldingAmount ?? '0',
                        receivers,
                    },
                );
                return {
                    ...context,
                    credentialDisclosures: await discloseUtilityCredentials(
                        sdk,
                        context.choiceContext.values['utility.digitalasset.com/sender-credentials'],
                        treasury,
                        'sender',
                    ),
                };
            },
        );
    return {
        disclosedContracts: [
            ...treasuryDisclosures,
            ...disclosedContracts,
            ...credentialDisclosures,
        ],
        treasuryAssetCids,
        transferFactoryCid: factoryId,
        assetTransferContext: choiceContext.values,
    };
};
