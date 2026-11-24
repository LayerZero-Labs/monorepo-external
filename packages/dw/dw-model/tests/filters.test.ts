import { describe, expect, it } from 'vitest';

import type { ChainName } from '@layerzerolabs/layerzero-definitions';

import { buildChainsFilter, buildOperationsFilter, involvedChainFilter } from '../src/filters';

const ethereum = 'ethereum' as ChainName;
const arbitrum = 'arbitrum' as ChainName;
const bsc = 'bsc' as ChainName;

/**
 * Grammar
 *
 *   filterChains     := filter (repeatable; one token per array entry, not comma-joined)
 *   filter           := ['!'] side            // chain-scoped
 *                    |  ['!'] side '->' side  // pathway-scoped
 *   side             := '*' | <ChainName>     // no whitespace around '->'
 *
 *   filterOperations := filter (repeatable)
 *   filter           := ['!'] ('*' | <operation name>)
 *
 * Semantics — positives/negatives are partitioned by scope (chain vs pathway vs operation)
 *
 *   omitted / []     allow everything in that scope
 *   positives        per-scope allowlist (OR within the scope); if any positives exist in a
 *                    scope, a value must match one of them. A pathway-scoped positive tightens
 *                    chain-scoped positives with the same local side
 *   '!' / negatives  denylist; a matching deny always wins over allow
 *   chain-scoped     filterChain, and pathway SOURCE (filterPathway requires filterChain(local)).
 *                    Does not constrain destination: `!bsc` still allows ethereum->bsc
 *   pathway-scoped   filterPathway. Positives also OR into filterChain via their local side
 *                    (`*->x` therefore allowlists every chain for per-chain work).
 *                    Pathway-scoped negatives do not shrink filterChain (`!*->*` = chain-only)
 */
describe('buildChainsFilter', () => {
    const includedChains = (input: string[] | undefined, names: ChainName[]) =>
        names.filter(buildChainsFilter(input).filterChain);

    const includedPathways = (input: string[] | undefined, pairs: [ChainName, ChainName][]) =>
        pairs.filter(([local, remote]) => buildChainsFilter(input).filterPathway(local, remote));

    const allChains = [ethereum, arbitrum, bsc];
    const allPathways: [ChainName, ChainName][] = [
        [ethereum, arbitrum],
        [ethereum, bsc],
        [arbitrum, ethereum],
        [arbitrum, bsc],
        [bsc, ethereum],
        [bsc, arbitrum],
    ];

    describe('default', () => {
        it.each([undefined, [] as string[]])('%j allows every chain and every pathway', (input) => {
            expect(includedChains(input, allChains)).toEqual(allChains);
            expect(includedPathways(input, allPathways)).toEqual(allPathways);
        });
    });

    describe('chain-scoped', () => {
        it('ethereum — only that chain; pathways from it to anywhere', () => {
            expect(includedChains(['ethereum'], allChains)).toEqual([ethereum]);
            expect(includedPathways(['ethereum'], allPathways)).toEqual([
                [ethereum, arbitrum],
                [ethereum, bsc],
            ]);
        });

        it('ethereum,bsc — allowlist of chains; pathways from any of them', () => {
            expect(includedChains(['ethereum', 'bsc'], allChains)).toEqual([ethereum, bsc]);
            expect(includedPathways(['ethereum', 'bsc'], allPathways)).toEqual([
                [ethereum, arbitrum],
                [ethereum, bsc],
                [bsc, ethereum],
                [bsc, arbitrum],
            ]);
        });

        it('!ethereum — every chain except ethereum; no pathways originating there', () => {
            expect(includedChains(['!ethereum'], allChains)).toEqual([arbitrum, bsc]);
            expect(includedPathways(['!ethereum'], allPathways)).toEqual([
                [arbitrum, ethereum],
                [arbitrum, bsc],
                [bsc, ethereum],
                [bsc, arbitrum],
            ]);
        });

        it('* — same as default (all chains, all pathways)', () => {
            expect(includedChains(['*'], allChains)).toEqual(allChains);
            expect(includedPathways(['*'], allPathways)).toEqual(allPathways);
        });

        it('!* — no chains, therefore no pathways', () => {
            expect(includedChains(['!*'], allChains)).toEqual([]);
            expect(includedPathways(['!*'], allPathways)).toEqual([]);
        });

        it('*,!ethereum — * as a positive plus a chain deny', () => {
            expect(includedChains(['*', '!ethereum'], allChains)).toEqual([arbitrum, bsc]);
        });
    });

    describe('pathway-scoped', () => {
        it('ethereum->arbitrum — chain ops on ethereum, only that pathway', () => {
            expect(includedChains(['ethereum->arbitrum'], allChains)).toEqual([ethereum]);
            expect(includedPathways(['ethereum->arbitrum'], allPathways)).toEqual([
                [ethereum, arbitrum],
            ]);
        });

        it('ethereum->* — chain ops on ethereum, every pathway from ethereum', () => {
            expect(includedChains(['ethereum->*'], allChains)).toEqual([ethereum]);
            expect(includedPathways(['ethereum->*'], allPathways)).toEqual([
                [ethereum, arbitrum],
                [ethereum, bsc],
            ]);
        });

        it('*->arbitrum — every pathway to arbitrum; filterChain stays all', () => {
            expect(includedChains(['*->arbitrum'], allChains)).toEqual(allChains);
            expect(includedPathways(['*->arbitrum'], allPathways)).toEqual([
                [ethereum, arbitrum],
                [bsc, arbitrum],
            ]);
        });

        it('*->* — every pathway; filterChain stays all', () => {
            expect(includedChains(['*->*'], allChains)).toEqual(allChains);
            expect(includedPathways(['*->*'], allPathways)).toEqual(allPathways);
        });

        it('!ethereum->arbitrum — drop one pathway, keep per-chain work on ethereum', () => {
            expect(includedChains(['!ethereum->arbitrum'], allChains)).toEqual(allChains);
            expect(includedPathways(['!ethereum->arbitrum'], allPathways)).toEqual(
                allPathways.filter(
                    ([local, remote]) => !(local === ethereum && remote === arbitrum),
                ),
            );
        });

        it('!ethereum->* — drop every pathway from ethereum, keep per-chain work on ethereum', () => {
            expect(includedChains(['!ethereum->*'], allChains)).toEqual(allChains);
            expect(includedPathways(['!ethereum->*'], allPathways)).toEqual([
                [arbitrum, ethereum],
                [arbitrum, bsc],
                [bsc, ethereum],
                [bsc, arbitrum],
            ]);
        });

        it('!*->* — no pathways, every chain (access-control / chain-only)', () => {
            expect(includedChains(['!*->*'], allChains)).toEqual(allChains);
            expect(includedPathways(['!*->*'], allPathways)).toEqual([]);
        });

        it('!*->arbitrum — drop every pathway to arbitrum', () => {
            expect(includedPathways(['!*->arbitrum'], allPathways)).toEqual([
                [ethereum, bsc],
                [arbitrum, ethereum],
                [arbitrum, bsc],
                [bsc, ethereum],
            ]);
        });
    });

    describe('mixing scopes', () => {
        it('ethereum,!*->* — per-chain on ethereum only, no pathways', () => {
            expect(includedChains(['ethereum', '!*->*'], allChains)).toEqual([ethereum]);
            expect(includedPathways(['ethereum', '!*->*'], allPathways)).toEqual([]);
        });

        it('ethereum,ethereum->arbitrum — chain allowlist plus a tighter pathway allowlist', () => {
            expect(includedChains(['ethereum', 'ethereum->arbitrum'], allChains)).toEqual([
                ethereum,
            ]);
            expect(includedPathways(['ethereum', 'ethereum->arbitrum'], allPathways)).toEqual([
                [ethereum, arbitrum],
            ]);
        });

        it('ethereum,!ethereum->arbitrum — from ethereum to anywhere except arbitrum', () => {
            expect(includedPathways(['ethereum', '!ethereum->arbitrum'], allPathways)).toEqual([
                [ethereum, bsc],
            ]);
        });

        it('ethereum->*,arbitrum->bsc — local operations on ethereum and arbitrum, all pathways from ethereum, arbitrum-bsc', () => {
            expect(includedChains(['ethereum->*', 'arbitrum->bsc'], allChains)).toEqual([
                ethereum,
                arbitrum,
            ]);
            expect(includedPathways(['ethereum->*', 'arbitrum->bsc'], allPathways)).toEqual([
                [ethereum, arbitrum],
                [ethereum, bsc],
                [arbitrum, bsc],
            ]);
        });

        it('ethereum,arbitrum->bsc — local operations on ethereum and arbitrum, all pathways from ethereum, arbitrum-bsc', () => {
            expect(includedChains(['ethereum', 'arbitrum->bsc'], allChains)).toEqual([
                ethereum,
                arbitrum,
            ]);
            expect(includedPathways(['ethereum', 'arbitrum->bsc'], allPathways)).toEqual([
                [ethereum, arbitrum],
                [ethereum, bsc],
                [arbitrum, bsc],
            ]);
        });

        it('a deny always wins over a matching allow', () => {
            expect(
                includedPathways(['ethereum->arbitrum', '!ethereum->arbitrum'], allPathways),
            ).toEqual([]);
            expect(includedChains(['ethereum', '!ethereum'], allChains)).toEqual([]);
        });
    });

    describe('invalid', () => {
        it.each(['', '!', '->ethereum', 'ethereum->', 'ethereum->arbitrum->bsc'])(
            'rejects %j',
            (raw) => {
                expect(() => buildChainsFilter([raw])).toThrow(`Invalid chain filter: "${raw}"`);
            },
        );

        it('rejects a side that is not * or a ChainName', () => {
            expect(() => buildChainsFilter(['not-a-chain'])).toThrow();
        });
    });
});

describe('involvedChainFilter', () => {
    const names = ['ethereum', 'arbitrum', 'bsc'] as ChainName[];

    it('ethereum->arbitrum involves the source and dest, not other chains', () => {
        const filter = involvedChainFilter(buildChainsFilter(['ethereum->arbitrum']), names);
        expect(names.filter(filter)).toEqual([ethereum, arbitrum]);
    });

    it('ethereum,ethereum->arbitrum still includes arbitrum as the pathway dest', () => {
        const filter = involvedChainFilter(
            buildChainsFilter(['ethereum', 'ethereum->arbitrum']),
            names,
        );
        expect(names.filter(filter)).toEqual([ethereum, arbitrum]);
    });

    it('with !*->* only the chains that pass filterChain', () => {
        const filter = involvedChainFilter(buildChainsFilter(['ethereum', '!*->*']), names);
        expect(names.filter(filter)).toEqual([ethereum]);
    });
});

describe('buildOperationsFilter', () => {
    const included = (input: string[] | undefined, names: string[]) =>
        names.filter(buildOperationsFilter(input).filterOperation);

    const ops = ['setPeer', 'setEnforcedOptions', 'setDelegate'];

    it.each([undefined, [] as string[]])('%j allows every operation', (input) => {
        expect(included(input, ops)).toEqual(ops);
    });

    it('setPeer — allowlist of one', () => {
        expect(included(['setPeer'], ops)).toEqual(['setPeer']);
    });

    it('!setPeer — everything except setPeer', () => {
        expect(included(['!setPeer'], ops)).toEqual(['setEnforcedOptions', 'setDelegate']);
    });

    it('* — all operations', () => {
        expect(included(['*'], ops)).toEqual(ops);
    });

    it('!* — no operations', () => {
        expect(included(['!*'], ops)).toEqual([]);
    });

    it('*,!setPeer — * plus a deny', () => {
        expect(included(['*', '!setPeer'], ops)).toEqual(['setEnforcedOptions', 'setDelegate']);
    });

    it('a deny always wins over a matching allow', () => {
        expect(included(['setPeer', '!setPeer'], ops)).toEqual([]);
    });

    it.each(['', '!'])('rejects %j', (raw) => {
        expect(() => buildOperationsFilter([raw])).toThrow(`Invalid operation filter: "${raw}"`);
    });
});
