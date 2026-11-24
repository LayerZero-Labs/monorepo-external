import { describe, expect, it } from 'vitest';

import { qualifiedTemplateName, templateIdMatches } from '../../src/refresh/deployment-address';

describe('qualifiedTemplateName', () => {
    it('strips the package-hash or #package-name prefix', () => {
        expect(qualifiedTemplateName('#splice-amulet:Splice.Amulet:SvRewardCoupon')).toBe(
            'Splice.Amulet:SvRewardCoupon',
        );
        expect(qualifiedTemplateName('1220deadbeef:Splice.Amulet:SvRewardCoupon')).toBe(
            'Splice.Amulet:SvRewardCoupon',
        );
    });
});

describe('templateIdMatches', () => {
    it('matches package-hash ledger ids against #package-name filters', () => {
        expect(
            templateIdMatches(
                '1220deadbeef:Splice.Amulet:SvRewardCoupon',
                '#splice-amulet:Splice.Amulet:SvRewardCoupon',
            ),
        ).toBe(true);
    });

    it('does not match different templates in the same package', () => {
        expect(
            templateIdMatches(
                '#splice-amulet:Splice.Amulet:Amulet',
                '#splice-amulet:Splice.Amulet:SvRewardCoupon',
            ),
        ).toBe(false);
    });
});
