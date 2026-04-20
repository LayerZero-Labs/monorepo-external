import { rpc, xdr } from '@stellar/stellar-sdk';

import { RPC_URL } from './constants';

/**
 * Event filter for scanning contract events
 */
export interface EventFilter {
    contractId: string;
}

/**
 * Parsed contract event
 */
export interface ParsedContractEvent {
    type: string;
    contractId: string;
    topics: any[];
    data: any;
    ledger: number;
    txHash: string;
}

/**
 * PacketSent event structure from endpoint_v2.rs
 */
export interface PacketSentEvent {
    encoded_packet: Buffer;
    options: Buffer;
    send_library: string;
}

/**
 * Scan for contract events within a ledger range
 */
export async function scanEvents(
    startLedgerSequence: number,
    filter: EventFilter,
): Promise<ParsedContractEvent[]> {
    const server = new rpc.Server(RPC_URL, { allowHttp: true });
    const latestLedger = await server.getLatestLedger();

    console.log('🔍 Scanning events from ledger', startLedgerSequence);

    try {
        // Wait for at least one new ledger to ensure events are indexed
        let endLedger = latestLedger.sequence;
        if (endLedger <= startLedgerSequence) {
            console.log('   Waiting for next ledger...');
            for (let i = 0; i < 10; i++) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                const newLedger = await server.getLatestLedger();
                if (newLedger.sequence > startLedgerSequence) {
                    endLedger = newLedger.sequence;
                    break;
                }
            }
        }

        const events = await server.getEvents({
            startLedger: startLedgerSequence,
            filters: [{ type: 'contract', contractIds: [filter.contractId] }],
            endLedger: endLedger,
        });

        const parsedEvents: ParsedContractEvent[] = [];

        for (const event of events.events || []) {
            try {
                const parsedEvent: ParsedContractEvent = {
                    type: event.type,
                    contractId: event.contractId?.contractId() || '',
                    topics: event.topic.map((t) => {
                        try {
                            return xdr.ScVal.fromXDR(Buffer.from(t, 'base64'));
                        } catch {
                            return t;
                        }
                    }),
                    data: event.value ? xdr.ScVal.fromXDR(event.value.toXDR()) : undefined,
                    ledger: event.ledger,
                    txHash: event.txHash,
                };
                parsedEvents.push(parsedEvent);
            } catch (e) {
                console.warn('Failed to parse event:', e);
            }
        }

        console.log(`✅ Found ${parsedEvents.length} events`);
        return parsedEvents;
    } catch (error: any) {
        console.error('Error scanning events:', error.message);
        throw error;
    }
}

/**
 * Scan for PacketSent events from the Endpoint contract
 */
export async function scanPacketSentEvents(
    endpointAddress: string,
    startLedger: number,
): Promise<PacketSentEvent[]> {
    console.log('📦 Scanning for PacketSent events...');
    const events = await scanEvents(startLedger, {
        contractId: endpointAddress,
    });

    // Filter for PacketSent events
    // PacketSent event has topics like ["PacketSent"] or similar
    const packetSentEvents: PacketSentEvent[] = [];

    for (const event of events) {
        try {
            // Check if this is a PacketSent event
            // The first topic should be the event name
            const firstTopic = event.topics[0];

            // Convert ScVal to string to check event name
            let eventName = '';
            if (firstTopic && firstTopic._switch?.name === 'scvSymbol') {
                eventName = firstTopic.value()?.toString() || '';
            }

            if (eventName === 'packet_sent') {
                // Parse the event data
                // PacketSent { encoded_packet, options, send_library }
                const eventData = event.data;

                // Try to extract fields from the struct
                if (eventData && eventData._switch?.name === 'scvMap') {
                    const map = eventData.value();
                    const packetEvent: Partial<PacketSentEvent> = {};

                    for (const entry of map || []) {
                        const key = entry.key().value()?.toString();
                        const value = entry.val();

                        if (key === 'encoded_packet' && value._switch?.name === 'scvBytes') {
                            packetEvent.encoded_packet = Buffer.from(value.value());
                        } else if (key === 'options' && value._switch?.name === 'scvBytes') {
                            packetEvent.options = Buffer.from(value.value());
                        } else if (key === 'send_library' && value._switch?.name === 'scvAddress') {
                            packetEvent.send_library = value.value()?.toString() || '';
                        }
                    }

                    if (
                        packetEvent.encoded_packet &&
                        packetEvent.options !== undefined &&
                        packetEvent.send_library
                    ) {
                        packetSentEvents.push(packetEvent as PacketSentEvent);
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to parse PacketSent event:', e);
        }
    }

    console.log(`✅ Found ${packetSentEvents.length} PacketSent events`);
    return packetSentEvents;
}

/**
 * Wait for new ledgers and scan for events
 */
export async function waitAndScanEvents(
    startLedger: number,
    contractAddress: string,
    eventName: string,
    maxWaitSeconds: number = 30,
): Promise<ParsedContractEvent[]> {
    const server = new rpc.Server(RPC_URL, { allowHttp: true });
    const endTime = Date.now() + maxWaitSeconds * 1000;

    console.log(`⏳ Waiting for ${eventName} events...`);

    while (Date.now() < endTime) {
        const currentLedger = await server.getLatestLedger();

        if (currentLedger.sequence > startLedger) {
            const events = await scanEvents(startLedger, {
                contractId: contractAddress,
            });

            const matchingEvents = events.filter((e) => {
                const firstTopic = e.topics[0];
                if (firstTopic && firstTopic._switch?.name === 'scvSymbol') {
                    const name = firstTopic.value()?.toString() || '';
                    return name === eventName;
                }
                return false;
            });

            if (matchingEvents.length > 0) {
                return matchingEvents;
            }
        }

        // Wait 1 second before checking again
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error(`Timeout waiting for ${eventName} events`);
}
