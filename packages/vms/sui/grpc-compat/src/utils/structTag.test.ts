import { describe, expect, it } from 'vitest';

import {
    coinTypeFromObjectType,
    splitTypeArgs,
    toShortAddress,
    toShortStructTag,
    toTypeTagAddress,
} from './structTag';

describe('toShortAddress', () => {
    it('shortens a system address (sui framework)', () => {
        expect(
            toShortAddress('0x0000000000000000000000000000000000000000000000000000000000000002'),
        ).toBe('0x2');
    });

    it('shortens a system address (sui_system)', () => {
        expect(
            toShortAddress('0x0000000000000000000000000000000000000000000000000000000000000003'),
        ).toBe('0x3');
    });

    it('leaves a non-system address at full width, matching legacy', () => {
        const paddedUsdc = '0x00c1a56ec9b177714b9469f2b48d97e5f2d55fca97a8b7d76b17bc2f0d09c3f0';
        expect(toShortAddress(paddedUsdc)).toBe(paddedUsdc);
    });

    it('is idempotent on an already-short system address', () => {
        expect(toShortAddress('0x2')).toBe('0x2');
    });
});

describe('toShortStructTag', () => {
    it('shortens only the system-address parts of a struct tag', () => {
        const grpc =
            '0x0000000000000000000000000000000000000000000000000000000000000002::dynamic_field::Field<u64,0x00c1a56ec9b177714b9469f2b48d97e5f2d55fca97a8b7d76b17bc2f0d09c3f0::usdc::USDC>';
        expect(toShortStructTag(grpc)).toBe(
            '0x2::dynamic_field::Field<u64, 0x00c1a56ec9b177714b9469f2b48d97e5f2d55fca97a8b7d76b17bc2f0d09c3f0::usdc::USDC>',
        );
    });
});

describe('toTypeTagAddress', () => {
    it('strips leading zeros from a non-system address, unlike toShortAddress', () => {
        const paddedUsdc = '0x00c1a56ec9b177714b9469f2b48d97e5f2d55fca97a8b7d76b17bc2f0d09c3f0';
        expect(toTypeTagAddress(paddedUsdc)).toBe(
            '0xc1a56ec9b177714b9469f2b48d97e5f2d55fca97a8b7d76b17bc2f0d09c3f0',
        );
    });

    it('still shortens a system address', () => {
        expect(
            toTypeTagAddress('0x0000000000000000000000000000000000000000000000000000000000000002'),
        ).toBe('0x2');
    });

    it('strips every address embedded in a full type-tag string', () => {
        const grpc =
            '0x00c1a56ec9b177714b9469f2b48d97e5f2d55fca97a8b7d76b17bc2f0d09c3f0::coin::Coin<0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI>';
        expect(toTypeTagAddress(grpc)).toBe(
            '0xc1a56ec9b177714b9469f2b48d97e5f2d55fca97a8b7d76b17bc2f0d09c3f0::coin::Coin<0x2::sui::SUI>',
        );
    });

    it('is idempotent on an already-short address', () => {
        expect(toTypeTagAddress('0x2')).toBe('0x2');
    });
});

describe('coinTypeFromObjectType', () => {
    it('extracts the inner coin type from a Coin<T> object type', () => {
        expect(coinTypeFromObjectType('0x2::coin::Coin<0x2::sui::SUI>')).toBe('0x2::sui::SUI');
    });

    it('returns an empty string when there is no generic parameter', () => {
        expect(coinTypeFromObjectType('0x2::coin::Coin')).toBe('');
    });

    it('handles a node-supplied type with many `<` and no closing `>` in linear time', () => {
        const start = performance.now();
        expect(coinTypeFromObjectType(`0x2::coin::Coin${'<'.repeat(40_000)}`)).toBe('');
        expect(performance.now() - start).toBeLessThan(500);
    });
});

describe('splitTypeArgs', () => {
    it('splits at the first `<` when the type ends with `>`', () => {
        expect(
            splitTypeArgs(
                '0x2::dynamic_field::Field<0x2::object::ID, 0x2::coin::Coin<0x2::sui::SUI>>',
            ),
        ).toEqual({
            base: '0x2::dynamic_field::Field',
            typeArgs: '0x2::object::ID, 0x2::coin::Coin<0x2::sui::SUI>',
        });
    });

    it('returns no type arguments when there is no closing `>`', () => {
        expect(splitTypeArgs('0x2::coin::Coin')).toEqual({
            base: '0x2::coin::Coin',
            typeArgs: undefined,
        });
        expect(splitTypeArgs('0x2::coin::Coin<0x2::sui::SUI')).toEqual({
            base: '0x2::coin::Coin<0x2::sui::SUI',
            typeArgs: undefined,
        });
    });
});
