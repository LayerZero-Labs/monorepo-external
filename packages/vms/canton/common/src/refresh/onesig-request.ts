import type { JsActiveContract } from '../open-api/models';
import type { CantonSdk } from '../sdk/canton-sdk';
import type { CantonDisclosedContract } from '../transaction';
import { areExpectedSignatories, getCreateArgumentField } from '../trusted-origin';
import { callbackDisclosure } from './callback-contracts';
import type { CantonOneSigRequestContextRefresh } from './plan';

const ONESIG_CONFIG = '#layerzero-onesigv1:OneSigConfig:OneSigConfig';
const FACTORY = '#layerzero-request-factory:RequestFactory:RequestFactory';
const FACTORY_CONFIG = '#layerzero-request-factory:RequestFactoryConfig:RequestFactoryConfig';
const IOAPP = '#layerzero-ioapp:IOApp:IOApp';
const OAPP_CONFIG = '#layerzero-ioapp-config:IOAppConfig:IOAppConfig';
const ACCESS_CONTROL = '#layerzero-iaccess-control:IAccessControl:IAccessControl';

type Input = CantonOneSigRequestContextRefresh['resolver'];
type Identity = { admin: string; id: string };
export type CantonOneSigRequestContext =
    | { tag: 'RequestContext'; value: { ownerConfig: string; timestamp: string } }
    | {
          tag: 'OAppRequestContext';
          value: {
              ioAppCid: string;
              oappConfig: string;
              accessControlCid: string | null;
              requestFactoryConfig: string;
              timestamp: string;
          };
      };

const sameIdentity = (value: unknown, identity: Identity): boolean =>
    getCreateArgumentField(value, 'admin') === identity.admin &&
    getCreateArgumentField(value, 'id') === identity.id;
const exactlyOne = (contracts: JsActiveContract[], label: string): JsActiveContract => {
    if (contracts.length !== 1)
        throw new Error(`Expected exactly one ${label}, found ${contracts.length}`);
    return contracts[0]!;
};
const requiredText = (value: unknown, label: string): string => {
    if (typeof value !== 'string' || !value) throw new Error(`Missing ${label}`);
    return value;
};

export const resolveCantonOneSigRequestContext = async (
    sdk: CantonSdk,
    input: Input,
    timestamp?: string,
): Promise<{
    context: CantonOneSigRequestContext;
    disclosedContracts: CantonDisclosedContract[];
}> => {
    const offset = await sdk.getLedgerEndOffset();
    const parties = [...new Set([input.informee, ...(input.readAs ?? [])])];
    const templateContracts = async (templateId: string) => {
        const [name, ...entity] = templateId.slice(1).split(':');
        return (
            await sdk.queryActiveContractsByParties(parties, offset, [templateId], {
                includeCreatedEventBlob: true,
            })
        ).filter(
            ({ createdEvent }) =>
                createdEvent.packageName === name &&
                createdEvent.templateId.split(':').slice(1).join(':') === entity.join(':'),
        );
    };
    const interfaceContracts = async (interfaceId: string, admin: string) => {
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
                areExpectedSignatories(contract.createdEvent, [admin])
                ? [{ contract, view: view.viewValue as Record<string, unknown> }]
                : [];
        });
    };
    const disclosedContracts: CantonDisclosedContract[] = [];
    const disclose = (contract: JsActiveContract) => {
        disclosedContracts.push(callbackDisclosure(contract));
        return contract.createdEvent.contractId;
    };
    let factoryCid: string;
    let gateway: string | undefined;
    let oapp: { ioAppCid: string; oappConfig: string; accessControlCid: string | null } | undefined;
    if (input.request.kind === 'request') {
        const { admin, oneSigId } = input.request.oneSig;
        const config = exactlyOne(
            (await templateContracts(ONESIG_CONFIG)).filter(
                ({ createdEvent }) =>
                    areExpectedSignatories(createdEvent, [admin]) &&
                    getCreateArgumentField(createdEvent.createArgument, 'admin') === admin &&
                    getCreateArgumentField(createdEvent.createArgument, 'oneSigId') === oneSigId,
            ),
            'OneSig config',
        );
        factoryCid = requiredText(
            getCreateArgumentField(config.createdEvent.createArgument, 'requestFactoryCid'),
            'OneSig request factory',
        );
    } else {
        const { oappId } = input.request;
        const [ioApps, configs, accessControls] = await Promise.all([
            interfaceContracts(IOAPP, oappId.admin),
            interfaceContracts(OAPP_CONFIG, oappId.admin),
            interfaceContracts(ACCESS_CONTROL, oappId.admin),
        ]);
        const ioApp = exactlyOne(
            ioApps
                .filter(({ view }) => sameIdentity(view.oappId, oappId))
                .map(({ contract }) => contract),
            'IOApp',
        );
        const config = exactlyOne(
            configs
                .filter(({ view }) => sameIdentity(view.oappId, oappId))
                .map(({ contract }) => contract),
            'OApp config',
        );
        gateway = requiredText(
            ioApps.find(({ contract }) => contract === ioApp)!.view.oappGateway,
            'OApp gateway',
        );
        factoryCid = requiredText(
            getCreateArgumentField(config.createdEvent.createArgument, 'requestFactoryCid'),
            'OApp request factory',
        );
        const matchingAccess = accessControls.filter(
            ({ view }) =>
                sameIdentity(view.scope, oappId) &&
                getCreateArgumentField(view.scope, 'category') === 'oapp',
        );
        if (matchingAccess.length > 1) throw new Error('Ambiguous OApp access control');
        if (input.request.kind === 'oappAccept' && matchingAccess.length !== 1)
            throw new Error('OApp Accept requires access control');
        oapp = {
            ioAppCid: disclose(ioApp),
            oappConfig: disclose(config),
            accessControlCid: matchingAccess[0] ? disclose(matchingAccess[0].contract) : null,
        };
    }
    const factory = exactlyOne(
        (await templateContracts(FACTORY)).filter(
            ({ createdEvent }) => createdEvent.contractId === factoryCid,
        ),
        'configured request factory',
    );
    const handler = requiredText(
        getCreateArgumentField(factory.createdEvent.createArgument, 'handler'),
        'request factory handler',
    );
    if (
        !areExpectedSignatories(factory.createdEvent, [handler]) ||
        getCreateArgumentField(factory.createdEvent.createArgument, 'dso') !== input.dsoParty ||
        (gateway !== undefined && gateway !== handler)
    ) {
        throw new Error('Request factory authority, DSO or OApp gateway mismatch');
    }
    disclose(factory);
    const ownerConfig = exactlyOne(
        (await templateContracts(FACTORY_CONFIG)).filter(
            ({ createdEvent }) =>
                areExpectedSignatories(createdEvent, [handler]) &&
                getCreateArgumentField(createdEvent.createArgument, 'handler') === handler,
        ),
        'request factory config',
    );
    const ownerConfigCid = disclose(ownerConfig);
    const time = timestamp ?? new Date(Date.now() - 10_000).toISOString();
    return {
        context: oapp
            ? {
                  tag: 'OAppRequestContext',
                  value: { ...oapp, requestFactoryConfig: ownerConfigCid, timestamp: time },
              }
            : { tag: 'RequestContext', value: { ownerConfig: ownerConfigCid, timestamp: time } },
        disclosedContracts,
    };
};
