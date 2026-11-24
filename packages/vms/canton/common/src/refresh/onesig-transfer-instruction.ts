import { z } from 'zod';

import { parseAmuletDecimal } from '../amulet';
import type { ICantonClient } from '../client/interface';
import type { CantonSdk } from '../sdk/canton-sdk';
import { cantonDisclosedContractSchema } from '../transaction';
import { areExpectedSignatories } from '../trusted-origin';
import { cantonCallbackAppUid } from './callback';
import { callbackDisclosure } from './callback-contracts';
import type { CantonOneSigTransferInstructionContextRefresh } from './plan';
import {
    discoveryUrlsForAppUid,
    fetchTransferInstructionRegistryContext,
} from './registry-context';

const INTERFACE =
    '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction';
const providerDisclosuresSchema = z.array(
    cantonDisclosedContractSchema.extend({
        contractId: z.string().min(1),
        createdEventBlob: z.string().min(1),
        synchronizerId: z.string().min(1),
    }),
);
const metadata = z.object({ values: z.record(z.string(), z.string()) });
const decimal = z.string().regex(/^-?\d+(?:\.\d{1,10})?$/);
const instrument = z.object({ admin: z.string().min(1), id: z.string() });
const callSchema = z.object({
    tag: z.enum(['OpAcceptTransferInstruction', 'OpWithdrawTransferInstruction']),
    value: z.object({
        transferSender: z.string(),
        receiver: z.string(),
        amount: decimal,
        instrumentId: instrument,
        requestedAt: z.string(),
        executeBefore: z.string(),
        transferMeta: metadata,
        instructionMeta: metadata,
        extraArgsMeta: metadata,
    }),
});
const viewSchema = z.object({
    transfer: z.object({
        sender: z.string(),
        receiver: z.string(),
        amount: decimal,
        instrumentId: instrument,
        requestedAt: z.string(),
        executeBefore: z.string(),
        meta: metadata,
    }),
    meta: metadata,
    status: z.object({ tag: z.string() }),
});

const timeMicros = (value: string): bigint => {
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
        value,
    );
    const millis = match ? Date.parse(`${match[1]}${match[3]}`) : NaN;
    if (!Number.isFinite(millis)) throw new Error('Invalid transfer instruction time');
    return BigInt(millis) * 1000n + BigInt((match![2] ?? '').padEnd(6, '0'));
};
const sameMetadata = (left: z.infer<typeof metadata>, right: z.infer<typeof metadata>): boolean =>
    Object.keys(left.values).length === Object.keys(right.values).length &&
    Object.entries(left.values).every(([key, value]) => right.values[key] === value);

export const resolveCantonOneSigTransferInstructionContext = async (
    sdk: CantonSdk,
    input: CantonOneSigTransferInstructionContextRefresh['resolver'],
    signedCall: unknown,
    client: Pick<ICantonClient, 'getDsoParty' | 'getTransferInstructionContext'>,
) => {
    if ((signedCall as { tag?: unknown } | null)?.tag === 'OpRejectTransferInstruction')
        throw new Error('OpRejectTransferInstruction is not supported: OneSig aborts it on-ledger');
    const call = callSchema.parse(signedCall);
    const signed = call.value;
    const choice = call.tag === 'OpAcceptTransferInstruction' ? 'accept' : 'withdraw';
    if ((choice === 'withdraw' ? signed.transferSender : signed.receiver) !== input.admin)
        throw new Error('OneSig transfer instruction authority mismatch');
    const offset = await sdk.getLedgerEndOffset();
    const packageId = await sdk.getPackageId('splice-api-token-transfer-instruction-v1', [
        input.admin,
    ]);
    const interfaceId = `${packageId}:Splice.Api.Token.TransferInstructionV1:TransferInstruction`;
    const instructions = (
        await sdk.queryActiveContractsByInterface([input.admin], offset, [INTERFACE], {
            includeCreatedEventBlob: true,
        })
    ).filter(({ createdEvent }) => createdEvent.contractId === input.transferInstructionCid);
    if (instructions.length !== 1)
        throw new Error('Pinned OneSig transfer instruction is not active or visible');
    const instruction = instructions[0]!;
    const views =
        instruction.createdEvent.interfaceViews?.filter(
            (view) =>
                view.interfaceId === interfaceId &&
                (!view.viewStatus || view.viewStatus.code === 0),
        ) ?? [];
    if (
        views.length !== 1 ||
        !areExpectedSignatories(instruction.createdEvent, [signed.instrumentId.admin])
    )
        throw new Error('Invalid OneSig transfer instruction interface or signatory');
    const view = viewSchema.parse(views[0]!.viewValue);
    const transfer = view.transfer;
    if (
        transfer.sender !== signed.transferSender ||
        transfer.receiver !== signed.receiver ||
        parseAmuletDecimal(transfer.amount) !== parseAmuletDecimal(signed.amount) ||
        transfer.instrumentId.admin !== signed.instrumentId.admin ||
        transfer.instrumentId.id !== signed.instrumentId.id ||
        timeMicros(transfer.requestedAt) !== timeMicros(signed.requestedAt) ||
        timeMicros(transfer.executeBefore) !== timeMicros(signed.executeBefore) ||
        !sameMetadata(transfer.meta, signed.transferMeta) ||
        !sameMetadata(view.meta, signed.instructionMeta) ||
        (choice !== 'withdraw' && view.status.tag !== 'TransferPendingReceiverAcceptance')
    )
        throw new Error(
            'Pinned OneSig transfer instruction does not match signed intent or status',
        );
    const instructionDisclosure = callbackDisclosure(instruction);
    const canonical =
        signed.instrumentId.id === 'Amulet' &&
        signed.instrumentId.admin === (await client.getDsoParty());
    const bundle = await (async () => {
        if (canonical)
            return client.getTransferInstructionContext({
                contractId: input.transferInstructionCid,
                choice,
            });
        const urls = await discoveryUrlsForAppUid(
            sdk,
            input.informee,
            offset,
            cantonCallbackAppUid(signed.instrumentId.admin, signed.instrumentId.id),
        );
        if (urls.length > 1) throw new Error('Ambiguous transfer instruction registry');
        const url = urls[0] ?? input.registryUrls?.[signed.instrumentId.admin];
        if (!url) throw new Error('No registry for transfer instruction instrument');
        return fetchTransferInstructionRegistryContext(
            url,
            input.transferInstructionCid,
            choice,
            input.environment,
        );
    })();
    const providerDisclosures = providerDisclosuresSchema.parse(bundle.disclosedContracts);
    return {
        context: {
            tag: 'TransferInstructionContext' as const,
            value: {
                transferInstructionCid: input.transferInstructionCid,
                extraArgsContext: bundle.choiceContext,
            },
        },
        disclosedContracts: [instructionDisclosure, ...providerDisclosures],
    };
};
