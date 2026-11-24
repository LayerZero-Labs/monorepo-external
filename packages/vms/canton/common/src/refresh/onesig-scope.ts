import type { JsActiveContract } from '../open-api/models';
import type { CantonSdk } from '../sdk/canton-sdk';
import type { CantonDisclosedContract } from '../transaction';
import { areExpectedSignatories, getCreateArgumentField } from '../trusted-origin';
import { callbackDisclosure } from './callback-contracts';
import type { CantonOneSigScopeContextRefresh } from './plan';

const ACCESS_CONTROL = '#layerzero-iaccess-control:IAccessControl:IAccessControl';
type Input = CantonOneSigScopeContextRefresh['resolver'];
export const resolveCantonOneSigScopeContext = async (
    sdk: CantonSdk,
    input: Input,
): Promise<{
    context: { tag: string; value: Record<string, string | null> };
    disclosedContracts: CantonDisclosedContract[];
}> => {
    const offset = await sdk.getLedgerEndOffset();
    const parties = [...new Set([input.informee, ...(input.readAs ?? [])])];
    const matching = async (interfaceId: string): Promise<JsActiveContract[]> => {
        const [name, ...entity] = interfaceId.slice(1).split(':');
        const packageId = await sdk.getPackageId(name!, [input.informee]);
        const resolvedId = `${packageId}:${entity.join(':')}`;
        return (
            await sdk.queryActiveContractsByInterface(parties, offset, [interfaceId], {
                includeCreatedEventBlob: true,
            })
        ).filter(({ createdEvent }) => {
            const views =
                createdEvent.interfaceViews?.filter((view) => view.interfaceId === resolvedId) ??
                [];
            const view = views[0];
            const scope = getCreateArgumentField(view?.viewValue, 'scope');
            return (
                views.length === 1 &&
                view?.viewStatus?.code === 0 &&
                areExpectedSignatories(createdEvent, [input.scope.admin]) &&
                getCreateArgumentField(scope, 'category') === input.scope.category &&
                getCreateArgumentField(scope, 'admin') === input.scope.admin &&
                getCreateArgumentField(scope, 'id') === input.scope.id
            );
        });
    };
    const setter =
        input.operation === 'OpSetMinFee'
            ? {
                  interfaceId: '#layerzero-iminfee:IMinFee:IMinFee',
                  tag: 'MinFeeContext',
                  field: 'minFeeContractId',
              }
            : input.operation === 'OpSetMinPayoutValue'
              ? {
                    interfaceId: '#layerzero-iminpayoutvalue:IMinPayoutValue:IMinPayoutValue',
                    tag: 'MinPayoutValueContext',
                    field: 'minPayoutValueContractId',
                }
              : input.operation === 'OpSetProtocolLedgerTimeValidityPeriod'
                ? {
                      interfaceId:
                          '#layerzero-iledger-time-validity-period:ILedgerTimeValidityPeriod:ILedgerTimeValidityPeriod',
                      tag: 'LedgerTimeValidityContext',
                      field: 'ledgerTimeValidityContractId',
                  }
                : undefined;
    const targets = await matching(setter?.interfaceId ?? ACCESS_CONTROL);
    if (targets.length !== 1)
        throw new Error(`Expected exactly one scope target, found ${targets.length}`);
    const target = targets[0]!;
    const disclosedContracts = [callbackDisclosure(target)];
    if (!setter)
        return {
            context: {
                tag: 'AccessControlContext',
                value: { targetContractId: target.createdEvent.contractId },
            },
            disclosedContracts,
        };
    const access = await matching(ACCESS_CONTROL);
    if (access.length > 1) throw new Error('Ambiguous scope access control');
    if (access[0]) disclosedContracts.push(callbackDisclosure(access[0]));
    return {
        context: {
            tag: setter.tag,
            value: {
                [setter.field]: target.createdEvent.contractId,
                accessControlCid: access[0]?.createdEvent.contractId ?? null,
            },
        },
        disclosedContracts,
    };
};
