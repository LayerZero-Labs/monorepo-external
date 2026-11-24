import { parseAmuletDecimal } from '../amulet';
import type { CantonSdk } from '../sdk/canton-sdk';
import type { CantonDisclosedContract } from '../transaction';
import { areExpectedSignatories, getCreateArgumentField } from '../trusted-origin';
import { callbackDisclosure } from './callback-contracts';
import type { CantonOneSigDiscoveryContextRefresh } from './plan';

export const resolveCantonOneSigDiscoveryContext = async (
    sdk: CantonSdk,
    input: CantonOneSigDiscoveryContextRefresh['resolver'],
    timestamp?: string,
): Promise<{
    context: {
        tag: 'OAppDiscoveryContext';
        value: { ioAppCid: string; discoveryRegistryCid: string; timestamp: string };
    };
    disclosedContracts: CantonDisclosedContract[];
}> => {
    const offset = await sdk.getLedgerEndOffset();
    const packageId = await sdk.getPackageId('layerzero-ioapp', [input.informee]);
    const oapps = (
        await sdk.queryActiveContractsByInterface(
            [input.informee],
            offset,
            ['#layerzero-ioapp:IOApp:IOApp'],
            {
                includeCreatedEventBlob: true,
            },
        )
    ).flatMap((contract) => {
        const views =
            contract.createdEvent.interfaceViews?.filter(
                (view) => view.interfaceId === `${packageId}:IOApp:IOApp`,
            ) ?? [];
        const view = views[0];
        const identity = getCreateArgumentField(view?.viewValue, 'oappId');
        return views.length === 1 &&
            view?.viewStatus?.code === 0 &&
            areExpectedSignatories(contract.createdEvent, [input.oappId.admin]) &&
            getCreateArgumentField(identity, 'admin') === input.oappId.admin &&
            getCreateArgumentField(identity, 'id') === input.oappId.id
            ? [{ contract, gateway: getCreateArgumentField(view.viewValue, 'oappGateway') }]
            : [];
    });
    if (oapps.length !== 1)
        throw new Error(`Expected exactly one discovery IOApp, found ${oapps.length}`);
    const { contract: oapp, gateway } = oapps[0]!;
    if (typeof gateway !== 'string' || !gateway) throw new Error('Missing OApp gateway');
    const registries = (
        await sdk.queryActiveContracts(input.informee, offset, {
            templateIds: ['#layerzero-discovery-registry:DiscoveryRegistry:DiscoveryRegistry'],
            includeCreatedEventBlob: true,
        })
    ).filter(
        ({ createdEvent }) =>
            createdEvent.packageName === 'layerzero-discovery-registry' &&
            createdEvent.templateId.split(':').slice(1).join(':') ===
                'DiscoveryRegistry:DiscoveryRegistry' &&
            areExpectedSignatories(createdEvent, [gateway]) &&
            getCreateArgumentField(createdEvent.createArgument, 'handler') === gateway,
    );
    if (registries.length !== 1)
        throw new Error(`Expected exactly one discovery registry, found ${registries.length}`);
    const registry = registries[0]!;
    if (input.feeDsoParty !== undefined) {
        const minFee = getCreateArgumentField(registry.createdEvent.createArgument, 'minFee');
        if (typeof minFee !== 'string') throw new Error('Missing discovery registry minimum fee');
        if (
            parseAmuletDecimal(minFee) > 0n &&
            getCreateArgumentField(registry.createdEvent.createArgument, 'dso') !==
                input.feeDsoParty
        )
            throw new Error('Discovery registry DSO mismatch');
    }
    return {
        context: {
            tag: 'OAppDiscoveryContext',
            value: {
                ioAppCid: oapp.createdEvent.contractId,
                discoveryRegistryCid: registry.createdEvent.contractId,
                timestamp: timestamp ?? new Date(Date.now() - 10_000).toISOString(),
            },
        },
        disclosedContracts: [callbackDisclosure(oapp), callbackDisclosure(registry)],
    };
};
