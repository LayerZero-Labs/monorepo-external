import { z } from 'zod';

import type { ICantonClient } from '../client/interface';
import type { CantonSdk } from '../sdk/canton-sdk';
import { type CantonDisclosedContract, cantonDisclosedContractSchema } from '../transaction';
import { smallestUnitsToDamlDecimal } from '../types';
import { cantonCallbackAppUid } from './callback';
import { callbackDisclosure, callbackInterfaceView } from './callback-contracts';
import type { CantonOneSigTransferBatchRefresh } from './plan';
import {
    discloseUtilityCredentials,
    discoveryUrlsForAppUid,
    fetchCallbackHoldings,
    fetchTransferFactoryContext,
    mergeDisclosedContracts,
} from './registry-context';
import { parseDamlDecimal, selectContractAmounts } from './select-contracts';

const HOLDING = '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding';
const providerDisclosuresSchema = z.array(
    cantonDisclosedContractSchema.extend({
        contractId: z.string().min(1),
        createdEventBlob: z.string().min(1),
        synchronizerId: z.string().min(1),
    }),
);
const transferCallSchema = z.object({
    tag: z.literal('OpTransfer'),
    value: z.object({
        receiver: z.string().min(1),
        amount: z.string().regex(/^\d+(?:\.\d{1,10})?$/),
        instrumentId: z.object({ admin: z.string().min(1), id: z.string() }),
        instructionExpiry: z.object({ microseconds: z.string().regex(/^-?\d+$/) }),
    }),
});

export const resolveCantonOneSigTransferBatch = async (
    sdk: CantonSdk,
    input: CantonOneSigTransferBatchRefresh['resolver'],
    signedCalls: unknown[],
    client: Pick<ICantonClient, 'getDsoParty' | 'getAmuletTransferFactoryContext'>,
) => {
    const calls = z.array(transferCallSchema).min(1).parse(signedCalls);
    const groups = new Map<
        string,
        { instrumentId: { admin: string; id: string }; amount: bigint; inputHoldingCids: string[] }
    >();
    const instrumentKey = (instrument: { admin: string; id: string }) =>
        JSON.stringify([instrument.admin, instrument.id]);
    for (const { value } of calls) {
        const key = instrumentKey(value.instrumentId);
        const amount = parseDamlDecimal(value.amount, 'Transfer amount');
        if (amount <= 0n) throw new Error('Transfer amount must be positive');
        const group = groups.get(key);
        if (group) group.amount += amount;
        else groups.set(key, { instrumentId: value.instrumentId, amount, inputHoldingCids: [] });
    }
    const offset = await sdk.getLedgerEndOffset();
    const disclosedContracts: CantonDisclosedContract[] = [];
    for (const group of groups.values()) {
        const holdings = await fetchCallbackHoldings(sdk, input.admin, offset, group.instrumentId);
        const selected = selectContractAmounts(
            holdings,
            'amount',
            smallestUnitsToDamlDecimal(group.amount.toString()),
            (contract) =>
                parseDamlDecimal(
                    callbackInterfaceView(contract, HOLDING)?.amount,
                    `Holding ${contract.createdEvent.contractId} amount`,
                ),
        );
        group.inputHoldingCids = selected.map(({ createdEvent }) => createdEvent.contractId);
        disclosedContracts.push(...selected.map(callbackDisclosure));
    }
    const contexts = [];
    for (const { value } of calls) {
        const group = groups.get(instrumentKey(value.instrumentId))!;
        const canonical =
            value.instrumentId.id === 'Amulet' &&
            value.instrumentId.admin === (await client.getDsoParty());
        let url: string | undefined;
        if (!canonical) {
            const urls = await discoveryUrlsForAppUid(
                sdk,
                input.informee,
                offset,
                cantonCallbackAppUid(value.instrumentId.admin, value.instrumentId.id),
            );
            if (urls.length > 1) throw new Error('Ambiguous transfer registry');
            url = urls[0] ?? input.registryUrls?.[value.instrumentId.admin];
            if (!url) throw new Error('No registry for transfer instrument');
        }
        const millis = Date.now();
        const requestedAt = new Date(millis).toISOString();
        const deadline = BigInt(millis) * 1000n + BigInt(value.instructionExpiry.microseconds);
        const fraction = ((deadline % 1_000_000n) + 1_000_000n) % 1_000_000n;
        const executeBefore = new Date(Number((deadline - fraction) / 1000n))
            .toISOString()
            .replace('.000Z', `.${fraction.toString().padStart(6, '0')}Z`);
        const args = {
            instrumentId: value.instrumentId,
            sender: input.admin,
            receiver: value.receiver,
            amount: value.amount,
            inputHoldingCids: group.inputHoldingCids,
            requestedAt,
            executeBefore,
        };
        const bundle = canonical
            ? await client.getAmuletTransferFactoryContext(args)
            : await fetchTransferFactoryContext(url!, value.instrumentId, {
                  ...args,
                  environment: input.environment,
              });
        disclosedContracts.push(
            ...providerDisclosuresSchema.parse(bundle.disclosedContracts),
            ...(await discloseUtilityCredentials(
                sdk,
                bundle.choiceContext.values['utility.digitalasset.com/sender-credentials'],
                input.admin,
                'sender',
            )),
        );
        contexts.push({
            tag: 'TransferFactoryContext' as const,
            value: {
                transferFactoryCid: bundle.factoryId,
                inputHoldingCids: group.inputHoldingCids,
                timestamp: requestedAt,
                extraArgsContext: bundle.choiceContext,
            },
        });
    }
    return { contexts, disclosedContracts: mergeDisclosedContracts(disclosedContracts) };
};
