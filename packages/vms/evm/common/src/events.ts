import type { ContractEventName } from 'viem';
import { type Abi, type AbiEvent, type Address, type Hex, keccak256, type Log, toHex } from 'viem';

import type { HexString } from '@layerzerolabs/typescript-utils';

import type { ContractEvent, ExtractEvent } from './viemUtils';
import { getAbiEvent } from './viemUtils';

export interface QueryFilter {
    viemFilter: {
        address: Address | Address[];
        topics: readonly Hex[] | undefined;
    };
    abiEvent: AbiEvent;
}

export interface EnhancedLog extends Log<bigint, number, false> {
    event: string;
    eventSignature: string;
    args: Record<string, unknown>;
}

export type EnhancedEvent<Event extends { args: unknown; eventName: string }> = Omit<
    EnhancedLog,
    'args' | 'event'
> & {
    event: Event['eventName'];
    args: Event['args'];
};

export const matchQueryFilter = (log: Log, { viemFilter }: QueryFilter): boolean => {
    const addressMatches = [viemFilter.address]
        .flat()
        .some((addr) => addr?.toLowerCase() === log.address.toLowerCase());

    // Only check topics[0] as it contains the event signature hash which uniquely identifies the event type
    const topic0Matches = viemFilter.topics?.[0] === log.topics[0];

    return addressMatches && topic0Matches;
};

type Factory<abi extends Abi> = {
    readonly abi: abi;
    createInterface: () => {
        getEventTopic: (eventName: ContractEventName<abi>) => string;
        getEvent: (eventName: ContractEventName<abi>) => ExtractEvent<abi, ContractEventName<abi>>;
    };
};

export const getQueryFilterFromInterface = <T extends ContractEventName<abi>, abi extends Abi>(
    fac: Factory<abi>,
    address: HexString,
    eventName: T,
): QueryFilter => {
    const iface = fac.createInterface();
    return {
        viemFilter: {
            address,
            topics: [iface.getEventTopic(eventName) as Hex],
        },
        abiEvent: iface.getEvent(eventName),
    };
};

export const createGetQueryFilterFromEventName = <
    abi extends Abi,
    T extends ContractEventName<abi>,
>(
    fac: Factory<abi>,
    address: HexString,
): ((eventName: T) => QueryFilter) => {
    return (eventName: T) => getQueryFilterFromInterface(fac, address, eventName);
};

export const createGetQueryFilterFromEventNameWithDefaultInterface = <abi extends Abi>(
    abiInstance: abi,
    address: HexString,
) => {
    return createGetQueryFilterFromEventName<abi, ContractEventName<abi>>(
        {
            abi: abiInstance,
            createInterface: () => ({
                getEventTopic: (eventName: ContractEventName<abi>) => {
                    const event = getAbiEvent(abiInstance, eventName) as AbiEvent;
                    const signature = `${event.name}(${event.inputs?.map((i) => i.type).join(',')})`;
                    return keccak256(toHex(signature));
                },
                getEvent: (eventName: ContractEventName<abi>) =>
                    getAbiEvent(abiInstance, eventName),
            }),
        },
        address,
    );
};

export const createViemProcessQueryFilter = <abi extends Abi>(abi: abi, address: HexString) => {
    const queryFilter = createGetQueryFilterFromEventNameWithDefaultInterface(abi, address);
    return <eventName extends ContractEventName<abi>, PreProcessedEvent>(
        eventName: eventName,
        processFunctions: {
            preProcess: (
                event: EnhancedEvent<ContractEvent<abi, eventName>>,
            ) => Promise<PreProcessedEvent>;
            shouldProcess: (event: PreProcessedEvent) => Promise<boolean>;
            process: (event: PreProcessedEvent) => Promise<void>;
        },
    ) => {
        return {
            eventName,
            filter: queryFilter(eventName),
            preProcess: (event: EnhancedLog) =>
                processFunctions.preProcess(event as EnhancedEvent<ContractEvent<abi, eventName>>),
            shouldProcess: processFunctions.shouldProcess,
            process: processFunctions.process,
        };
    };
};
