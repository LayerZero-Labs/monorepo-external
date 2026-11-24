import type { JsActiveContract } from '../open-api/models';
import type { CantonDisclosedContract } from '../transaction';

export const callbackInterfaceView = (
    contract: JsActiveContract,
    interfaceId: string,
): Record<string, unknown> | undefined =>
    contract.createdEvent.interfaceViews?.find(
        (view) =>
            (view.interfaceId === interfaceId ||
                view.interfaceId.endsWith(interfaceId.slice(interfaceId.indexOf(':')))) &&
            (!view.viewStatus || view.viewStatus.code === 0),
    )?.viewValue as Record<string, unknown> | undefined;
export const callbackDisclosure = (contract: JsActiveContract): CantonDisclosedContract => {
    const { createdEvent, synchronizerId } = contract;
    if (!createdEvent.createdEventBlob)
        throw new Error(`Missing disclosure for ${createdEvent.contractId}`);
    return {
        contractId: createdEvent.contractId,
        templateId: createdEvent.templateId,
        createdEventBlob: createdEvent.createdEventBlob,
        synchronizerId,
    };
};
