import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseCantonDeferredValue } from '../../src/deferredValue';

const PREFIX = '<<CANTON_DEFERRED:';
const SUFFIX = '>>';

const encodeAddress = (nativeAddress: string): string => {
    const inner = nativeAddress.slice(PREFIX.length, -SUFFIX.length);
    return `0x${Buffer.from(inner, 'utf8').toString('hex')}02`.toLowerCase();
};

const deploymentRoots = [
    join(process.cwd(), '../../../../deployments/layerzero/mainnet/canton/deploymentInfo'),
    join(process.cwd(), '../../../../deployments/layerzero/testnet/canton/deploymentInfo'),
];

describe('Canton deploymentInfo deferred-ref artifacts', () => {
    const artifacts = deploymentRoots.flatMap((root) =>
        readdirSync(root)
            .filter((file) => file.endsWith('.json'))
            .map((file) => {
                const path = join(root, file);
                return {
                    path,
                    json: JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>,
                };
            })
            .filter(
                ({ json }) =>
                    typeof json.nativeAddress === 'string' &&
                    (json.nativeAddress as string).startsWith(PREFIX),
            ),
    );

    it('has deferred-ref deploy artifacts to check', () => {
        expect(artifacts.length).toBeGreaterThan(0);
    });

    it('hex address matches nativeAddress and parses as a deferred ref', () => {
        for (const { path, json } of artifacts) {
            const nativeAddress = json.nativeAddress as string;
            expect(json.address, path).toBe(encodeAddress(nativeAddress));
            expect(parseCantonDeferredValue(nativeAddress), path).toMatchObject({
                type: 'activeContractId',
                templateId: expect.any(String),
            });
        }
    });
});
