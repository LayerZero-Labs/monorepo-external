import type { JsActiveContract } from '../open-api/models';
import type { CantonSdk } from '../sdk/canton-sdk';
import type { CantonDisclosedContract } from '../transaction';
import { areExpectedSignatories, getCreateArgumentField } from '../trusted-origin';
import { callbackDisclosure } from './callback-contracts';
import type { CantonOneSigConfigContextRefresh } from './plan';

const OAPP_CONFIG = '#layerzero-ioapp-config:IOAppConfig:IOAppConfig';
const ACCESS_CONTROL = '#layerzero-iaccess-control:IAccessControl:IAccessControl';
const RATE_STATE = '#layerzero-rate-limiter:RateLimiterState:RateLimiterState';
const TRANSFER_RULE = '#layerzero-oft:Transfer.OftTransferRule:OftTransferRule';
const REQUEST_FACTORY = '#layerzero-request-factory:RequestFactory:RequestFactory';

type Input = CantonOneSigConfigContextRefresh['resolver'];
export type CantonOneSigConfigContext = {
    tag: 'ConfigContext';
    value: {
        configCid: string;
        accessControlCid: string | null;
        rateLimitStateCid: string | null;
        newTransferRuleCid: string | null;
        newRequestFactoryCid: string | null;
    };
};
const exactlyOne = (contracts: JsActiveContract[], label: string): JsActiveContract => {
    if (contracts.length !== 1)
        throw new Error(`Expected exactly one ${label}, found ${contracts.length}`);
    return contracts[0]!;
};

export const resolveCantonOneSigConfigContext = async (
    sdk: CantonSdk,
    input: Input,
): Promise<{
    context: CantonOneSigConfigContext;
    disclosedContracts: CantonDisclosedContract[];
}> => {
    const { oappId, operation } = input;
    const offset = await sdk.getLedgerEndOffset();
    const parties = [...new Set([input.informee, ...(input.readAs ?? [])])];
    const sameIdentity = (value: unknown): boolean =>
        getCreateArgumentField(value, 'admin') === oappId.admin &&
        getCreateArgumentField(value, 'id') === oappId.id;
    const templateContracts = async (templateId: string, admin: string) => {
        const [name, ...entity] = templateId.slice(1).split(':');
        return (
            await sdk.queryActiveContractsByParties(parties, offset, [templateId], {
                includeCreatedEventBlob: true,
            })
        ).filter(
            ({ createdEvent }) =>
                createdEvent.packageName === name &&
                createdEvent.templateId.split(':').slice(1).join(':') === entity.join(':') &&
                areExpectedSignatories(createdEvent, [admin]),
        );
    };
    const interfaceContracts = async (interfaceId: string) => {
        const [name, ...entity] = interfaceId.slice(1).split(':');
        const packageId = await sdk.getPackageId(name!, [input.informee]);
        const resolvedId = `${packageId}:${entity.join(':')}`;
        return (
            await sdk.queryActiveContractsByInterface(parties, offset, [interfaceId], {
                includeCreatedEventBlob: true,
            })
        ).flatMap((contract) => {
            const views =
                contract.createdEvent.interfaceViews?.filter(
                    (view) => view.interfaceId === resolvedId,
                ) ?? [];
            const view = views[0];
            return views.length === 1 &&
                view?.viewStatus?.code === 0 &&
                view.viewValue &&
                areExpectedSignatories(contract.createdEvent, [oappId.admin])
                ? [{ contract, view: view.viewValue as Record<string, unknown> }]
                : [];
        });
    };
    const disclosedContracts: CantonDisclosedContract[] = [];
    const disclose = (contract: JsActiveContract) => {
        disclosedContracts.push(callbackDisclosure(contract));
        return contract.createdEvent.contractId;
    };
    const [configs, accessControls] = await Promise.all([
        interfaceContracts(OAPP_CONFIG),
        interfaceContracts(ACCESS_CONTROL),
    ]);
    const configCid = disclose(
        exactlyOne(
            configs.filter(({ view }) => sameIdentity(view.oappId)).map(({ contract }) => contract),
            'OApp config',
        ),
    );
    const matchingAccess = accessControls.filter(
        ({ view }) =>
            sameIdentity(view.scope) && getCreateArgumentField(view.scope, 'category') === 'oapp',
    );
    if (matchingAccess.length > 1) throw new Error('Ambiguous OApp access control');
    const accessControlCid = matchingAccess[0] ? disclose(matchingAccess[0].contract) : null;
    let rateLimitStateCid: string | null = null;
    if (
        [
            'OpRateLimiterSetDefault',
            'OpRateLimiterSetEidOverride',
            'OpRateLimiterRemoveEidOverride',
            'OpRateLimiterSetState',
        ].includes(operation)
    ) {
        rateLimitStateCid = disclose(
            exactlyOne(
                (await templateContracts(RATE_STATE, oappId.admin)).filter(({ createdEvent }) =>
                    sameIdentity(getCreateArgumentField(createdEvent.createArgument, 'oappId')),
                ),
                'rate limiter state',
            ),
        );
    }
    let newTransferRuleCid: string | null = null;
    if (operation === 'OpSetTransferRule') {
        newTransferRuleCid = disclose(
            exactlyOne(
                (await templateContracts(TRANSFER_RULE, oappId.admin)).filter(({ createdEvent }) =>
                    sameIdentity(
                        getCreateArgumentField(createdEvent.createArgument, 'instrumentId'),
                    ),
                ),
                'transfer rule',
            ),
        );
    }
    let newRequestFactoryCid: string | null = null;
    if (operation === 'OpSetRequestFactory') {
        newRequestFactoryCid = disclose(
            exactlyOne(
                (await templateContracts(REQUEST_FACTORY, input.expectedHandler)).filter(
                    ({ createdEvent }) =>
                        getCreateArgumentField(createdEvent.createArgument, 'handler') ===
                        input.expectedHandler,
                ),
                'replacement request factory',
            ),
        );
    }
    return {
        context: {
            tag: 'ConfigContext',
            value: {
                configCid,
                accessControlCid,
                rateLimitStateCid,
                newTransferRuleCid,
                newRequestFactoryCid,
            },
        },
        disclosedContracts,
    };
};
