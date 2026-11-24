import z from 'zod';

import type { ChainName } from '@layerzerolabs/layerzero-definitions';
import { chainNameSchema } from '@layerzerolabs/layerzero-definitions';

type Side = ChainName | 'ALL';

type ChainFilterElement = {
    negate: boolean;
    local: Side;
    remote?: Side;
};

export interface ChainsFilter {
    filterChain: (chainName: ChainName) => boolean;
    filterPathway: (local: ChainName, remote: ChainName) => boolean;
}

const parseSide = (raw: string, original: string): Side => {
    if (raw === '*') {
        return 'ALL';
    }
    const side = chainNameSchema.safeParse(raw);
    if (!side.success) {
        throw new Error(`Invalid chain filter: "${original}" (unknown chain "${raw}")`);
    }
    return side.data;
};

const parseChainFilter = (raw: string): ChainFilterElement => {
    const negate = raw.startsWith('!');
    const body = negate ? raw.slice(1) : raw;
    if (body.length === 0) {
        throw new Error(`Invalid chain filter: "${raw}"`);
    }
    const parts = body.split('->');
    if (parts.length > 2) {
        throw new Error(`Invalid chain filter: "${raw}"`);
    }
    if (parts.length === 2) {
        return {
            negate,
            local: parseSide(parts[0]!, raw),
            remote: parseSide(parts[1]!, raw),
        };
    }
    return { negate, local: parseSide(parts[0]!, raw) };
};

const matches = (side: Side, value: ChainName) => [value, 'ALL'].includes(side);

const passes = <T>(positives: T[], negatives: T[], match: (elem: T) => boolean) =>
    (positives.length === 0 || positives.some(match)) && !negatives.some(match);

export const buildChainsFilter = (chainsFilterInput?: string[]): ChainsFilter => {
    const elements = (chainsFilterInput ?? []).map(parseChainFilter);
    const chainElements = elements.filter((elem) => elem.remote === undefined);
    const chainPositives = chainElements.filter((elem) => !elem.negate);
    const chainNegatives = chainElements.filter((elem) => elem.negate);
    const pathwayElements = elements.filter((elem) => elem.remote !== undefined);
    const pathwayPositives = pathwayElements.filter((elem) => !elem.negate);
    const pathwayNegatives = pathwayElements.filter((elem) => elem.negate);

    const filterChain = (chainName: ChainName) =>
        passes([...chainPositives, ...pathwayPositives], chainNegatives, (elem) =>
            matches(elem.local, chainName),
        );

    return {
        filterChain,
        filterPathway: (local, remote) => {
            const positives = pathwayPositives.some((elem) => matches(elem.local, local))
                ? pathwayPositives
                : [...chainPositives, ...pathwayPositives];
            return (
                filterChain(local) &&
                passes(
                    positives,
                    pathwayNegatives,
                    (elem) =>
                        matches(elem.local, local) &&
                        (elem.remote === undefined || matches(elem.remote, remote)),
                )
            );
        },
    };
};

export const involvedChainFilter =
    (chainsFilter: ChainsFilter, chainNames: ChainName[]) =>
    (chainName: ChainName): boolean =>
        chainsFilter.filterChain(chainName) ||
        chainNames.some(
            (other) =>
                chainsFilter.filterPathway(chainName, other) ||
                chainsFilter.filterPathway(other, chainName),
        );

type OperationFilterElement = {
    negate: boolean;
    operation: string | 'ALL';
};

export interface OperationsFilter {
    filterOperation: (operation: string) => boolean;
}

const parseOperationFilter = (raw: string): OperationFilterElement => {
    const negate = raw.startsWith('!');
    const body = negate ? raw.slice(1) : raw;
    if (body.length === 0) {
        throw new Error(`Invalid operation filter: "${raw}"`);
    }
    return { negate, operation: body === '*' ? 'ALL' : body };
};

export const buildOperationsFilter = (operationsFilterInput?: string[]): OperationsFilter => {
    const elements = (operationsFilterInput ?? []).map(parseOperationFilter);
    const positives = elements.filter((elem) => !elem.negate);
    const negatives = elements.filter((elem) => elem.negate);

    return {
        filterOperation: (operation) =>
            passes(positives, negatives, (elem) => [operation, 'ALL'].includes(elem.operation)),
    };
};

const filterEntrySchema = (parse: (raw: string) => unknown) =>
    z.string().superRefine((raw, ctx) => {
        try {
            parse(raw);
        } catch (error) {
            ctx.addIssue({
                code: 'custom',
                message: error instanceof Error ? error.message : String(error),
            });
        }
    });

export const filterChainsArgSchema = z
    .array(filterEntrySchema(parseChainFilter))
    .optional()
    .describe(
        [
            'Chain/pathway filters, repeatable. Syntax: [!]<chain> or [!]<local>-><remote>, where * matches any chain.',
            'Omitted or empty allows everything, if any positive filters are given it whitelists',
            'Non-pathway selectors, e.g., ("ethereum") select both the chain and all pathways FROM it.',
        ].join('\n'),
    );

export const filterOperationsArgSchema = z
    .array(filterEntrySchema(parseOperationFilter))
    .optional()
    .describe(
        [
            'Operation filters, repeatable. Syntax: [!]<operation> or [!]*.',
            'Omitted or empty allows everything, if any positive filters are given it whitelists',
        ].join('\n'),
    );
