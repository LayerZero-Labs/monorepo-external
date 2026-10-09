import { toBase64 } from '@mysten/sui-v2/utils';
import { describe, expect, it } from 'vitest';

import { LZ_EVENT_BYTE_VECTOR_FIELDS } from '@layerzerolabs/common-suimove/events';

import { applyByteVectorFixups, eventModuleStructPath } from './eventJson';

describe('eventModuleStructPath', () => {
    it('extracts module::Name from a fully-qualified event type', () => {
        expect(eventModuleStructPath('0x2::messaging_channel::PacketSentEvent')).toBe(
            'messaging_channel::PacketSentEvent',
        );
    });

    it('strips generic type parameters before extracting', () => {
        expect(eventModuleStructPath('0x2::coin::Coin<0x2::sui::SUI>')).toBe('coin::Coin');
    });

    it('handles a node-supplied type with many `<` and no closing `>` in linear time', () => {
        const start = performance.now();
        eventModuleStructPath(`0x2::coin::Coin${'<'.repeat(40_000)}`);
        expect(performance.now() - start).toBeLessThan(500);
    });
});

describe('applyByteVectorFixups', () => {
    it('base64-decodes the known byte-vector fields for a matching event type', () => {
        const bytes = new TextEncoder().encode('hello');
        const encoded = toBase64(bytes);
        const result = applyByteVectorFixups(
            { guid: { bytes: encoded }, message: encoded, unrelated: 'keep-me' },
            '0x2::messaging_composer::ComposeSentEvent',
        );
        expect(result).toEqual({
            guid: { bytes: Array.from(bytes) },
            message: Array.from(bytes),
            unrelated: 'keep-me',
        });
    });

    it('leaves parsedJson untouched for an event type with no registered fixups', () => {
        const parsedJson = { a: 'b64-looking-string' };
        expect(applyByteVectorFixups(parsedJson, '0x2::other_module::SomeOtherEvent')).toBe(
            parsedJson,
        );
    });

    it('does not corrupt an unrelated module emitting a same-named struct', () => {
        const parsedJson = { encoded_packet: 'not-actually-bytes' };
        // Same bare struct name (`PacketSentEvent`) but a different module — must not match.
        expect(
            applyByteVectorFixups(parsedJson, '0xdead::third_party_module::PacketSentEvent'),
        ).toBe(parsedJson);
    });

    it('applies fixups for a same module::Struct emitted by a different package address', () => {
        // This is the intended, documented behavior (see the `eventModuleStructPath` comment):
        // the address is dropped deliberately so every OFT deployment's events are recognized,
        // not just one. A third-party package that happens to declare the identical
        // `messaging_channel::PacketSentEvent` path would also match — that trade-off is
        // accepted, not a bug.
        const bytes = new TextEncoder().encode('hello');
        const encoded = toBase64(bytes);
        const parsedJson = { encoded_packet: encoded, options: encoded };
        expect(
            applyByteVectorFixups(parsedJson, '0xdead::messaging_channel::PacketSentEvent'),
        ).toEqual({
            encoded_packet: Array.from(bytes),
            options: Array.from(bytes),
        });
    });

    it('leaves a non-base64 string in a registered field untouched instead of throwing', () => {
        const bytes = new TextEncoder().encode('hello');
        const encoded = toBase64(bytes);
        const parsedJson = { guid: { bytes: 'not base64!!' }, message: encoded };
        expect(
            applyByteVectorFixups(parsedJson, '0xdead::messaging_composer::ComposeSentEvent'),
        ).toEqual({
            guid: { bytes: 'not base64!!' },
            message: Array.from(bytes),
        });
    });

    it('passes through non-object parsedJson unchanged', () => {
        expect(
            applyByteVectorFixups(undefined, '0x2::messaging_channel::PacketSentEvent'),
        ).toBeUndefined();
        expect(applyByteVectorFixups(null, '0x2::messaging_channel::PacketSentEvent')).toBeNull();
    });

    const setPath = (obj: Record<string, unknown>, path: string, value: unknown): void => {
        const keys = path.split('.');
        const lastKey = keys.pop()!;
        let cursor = obj;
        for (const key of keys) {
            cursor = (cursor[key] as Record<string, unknown>) ??= {};
        }
        cursor[lastKey] = value;
    };

    it.each(Object.entries(LZ_EVENT_BYTE_VECTOR_FIELDS))(
        'base64-decodes every registered field for %s',
        (moduleStructPath, fieldPaths) => {
            const bytes = new TextEncoder().encode('lz-payload');
            const encoded = toBase64(bytes);
            const parsedJson: Record<string, unknown> = {};
            for (const path of fieldPaths) {
                setPath(parsedJson, path, encoded);
            }

            const result = applyByteVectorFixups(parsedJson, `0x2::${moduleStructPath}`);

            for (const path of fieldPaths) {
                expect(result).toHaveProperty(path, Array.from(bytes));
            }
        },
    );
});
