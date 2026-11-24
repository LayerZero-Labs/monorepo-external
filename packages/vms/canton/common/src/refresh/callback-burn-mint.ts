import type { InstrumentId } from '../client/amulet';
import type { CantonSdk } from '../sdk';
import type { CantonDisclosedContract } from '../transaction';
import { isTrustedOrigin } from '../trusted-origin';
import { callbackDisclosure, callbackInterfaceView } from './callback-contracts';
import { withCantonCallbackRegistry } from './callback-registry';
import {
    assertSafeRegistryUrl,
    callbackHoldingAmount,
    discloseUtilityCredentials,
    fetchCallbackHoldings,
    fetchMergedTransferFactoryContext,
    postFactoryContext,
    type TransferFactoryContext,
} from './registry-context';
import { selectLargestContracts } from './select-contracts';

const DELEGATE_TEMPLATE = '#layerzero-burn-mint-adapter:BurnMintDelegate:BurnMintDelegate';
const HOLDING_INTERFACE = '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding';
const MINT_FACTORY_PATH = 'api/utilities/v0/registry/burn-mint-instruction/v0/burn-mint-factory';
type DelegatePayload = { instrumentId: InstrumentId; delegate: string; burnMintFactoryCid: string };

const applyDelegate = async (
    sdk: CantonSdk,
    informee: string,
    offset: number,
    factory: TransferFactoryContext,
    instrumentId: InstrumentId,
    oappAdmin: string,
): Promise<TransferFactoryContext> => {
    const contracts = await sdk.queryActiveContracts(informee, offset, {
        templateIds: [DELEGATE_TEMPLATE],
        includeCreatedEventBlob: true,
    });
    const matches = contracts.filter(({ createdEvent }) => {
        const payload = createdEvent.createArgument as DelegatePayload;
        return (
            payload.instrumentId?.admin === instrumentId.admin &&
            payload.instrumentId.id === instrumentId.id &&
            payload.delegate === oappAdmin &&
            isTrustedOrigin(createdEvent, instrumentId.admin, 'instrumentId.admin')
        );
    });
    if (matches.length > 1) {
        throw new Error(
            `Multiple BurnMintDelegate contracts for instrument ${instrumentId.admin}/${instrumentId.id} delegate=${oappAdmin} (${matches.length})`,
        );
    }
    const match = matches[0];
    if (!match) {
        if (oappAdmin !== instrumentId.admin) {
            throw new Error(
                `No BurnMintDelegate for instrument ${instrumentId.admin}/${instrumentId.id} delegate=${oappAdmin}; the adapter admin is not the instrument admin`,
            );
        }
        return factory;
    }
    const payload = match.createdEvent.createArgument as DelegatePayload;
    if (payload.burnMintFactoryCid !== factory.factoryId) {
        throw new Error(
            `BurnMintDelegate ${match.createdEvent.contractId} points at burn-mint factory ${payload.burnMintFactoryCid}, but the registry returned ${factory.factoryId}`,
        );
    }
    return {
        factoryId: match.createdEvent.contractId,
        choiceContext: factory.choiceContext,
        disclosedContracts: [callbackDisclosure(match), ...factory.disclosedContracts],
    };
};

export const resolveBurnMintCallbackContext = async ({
    sdk,
    informee,
    appUid,
    oappAdmin,
    mintEscrow,
    instrumentId,
    offset,
    receivers,
    environment,
}: {
    sdk: CantonSdk;
    informee: string;
    appUid: string;
    oappAdmin: string;
    mintEscrow: string;
    instrumentId: InstrumentId;
    offset: number;
    receivers: string[];
    environment?: string;
}): Promise<{
    disclosedContracts: CantonDisclosedContract[];
    transferFactoryCid?: string;
    assetTransferContext?: Record<string, unknown>;
    burnMintFactoryCid?: string;
    burnMintExtraArgs?: Record<string, unknown>;
    burnMintOutputContext?: Record<string, unknown>;
}> => {
    if (receivers.length === 0) return { disclosedContracts: [] };
    const holdings = selectLargestContracts(
        await fetchCallbackHoldings(sdk, mintEscrow, offset, instrumentId),
        callbackHoldingAmount,
    );
    const inputHoldingCids = holdings.map((holding) => holding.createdEvent.contractId);
    const firstAmount = holdings
        .map((holding) => callbackInterfaceView(holding, HOLDING_INTERFACE)?.amount)
        .find((amount): amount is string => amount != null && amount !== '0');
    return withCantonCallbackRegistry(
        { sdk, informee, offset, appUid, instrumentId, environment },
        async (registry) => {
            if (registry.kind === 'amulet') {
                throw new Error('Amulet cannot be minted through a burn-mint adapter');
            }
            const parsed = assertSafeRegistryUrl(registry.url, {
                environment,
                label: 'burn-mint-factory utilities URL',
            });
            const registryMintFactory = await postFactoryContext(
                new URL(MINT_FACTORY_PATH, `${parsed.origin}/`).toString(),
                {
                    instrumentId,
                    inputHoldingCids: [],
                    outputs: [{ owner: mintEscrow, amount: '1' }],
                },
                { probeName: 'burn-mint-factory' },
            );
            const mintFactory = await applyDelegate(
                sdk,
                informee,
                offset,
                registryMintFactory,
                instrumentId,
                oappAdmin,
            );
            const issuerCredentials = await discloseUtilityCredentials(
                sdk,
                mintFactory.choiceContext.values['utility.digitalasset.com/issuer-credentials'],
                mintEscrow,
                'issuer',
            );
            const transferFactory = await fetchMergedTransferFactoryContext(
                registry.url,
                instrumentId,
                {
                    environment,
                    inputHoldingCids,
                    sender: mintEscrow,
                    amount: firstAmount ?? '0',
                    receivers,
                },
            );
            const senderCredentials = await discloseUtilityCredentials(
                sdk,
                transferFactory.choiceContext.values['utility.digitalasset.com/sender-credentials'],
                mintEscrow,
                'sender',
            );
            return {
                disclosedContracts: [
                    ...mintFactory.disclosedContracts,
                    ...issuerCredentials,
                    ...transferFactory.disclosedContracts,
                    ...senderCredentials,
                ],
                burnMintFactoryCid: mintFactory.factoryId,
                burnMintExtraArgs: mintFactory.choiceContext.values,
                burnMintOutputContext: {},
                transferFactoryCid: transferFactory.factoryId,
                assetTransferContext: transferFactory.choiceContext.values,
            };
        },
    );
};
