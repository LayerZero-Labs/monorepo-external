import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { EnvironmentVariable, VolumeMapping } from '../config';
import { CARGO_TARGET_CACHE_PATH } from '../config';
import {
    dockerPlatformProbeStampPath,
    mergeToolEnv,
    resolveCargoBuildDirEnv,
} from './tool-executor';

const withCache: readonly VolumeMapping[] = [
    { type: 'isolate', containerPath: CARGO_TARGET_CACHE_PATH, name: 'solana-target' },
];

const buildDirFor = (checkoutRoot: string, volumes = withCache) =>
    resolveCargoBuildDirEnv(volumes, checkoutRoot).find(
        ({ name }) => name === 'CARGO_BUILD_BUILD_DIR',
    )?.value;

describe(resolveCargoBuildDirEnv, () => {
    it('points cargo build-dir into the cache volume, per checkout and workspace', () => {
        expect(buildDirFor('/repos/checkout-a')).toMatch(
            new RegExp(`^${CARGO_TARGET_CACHE_PATH}/[0-9a-f]{16}/\\{workspace-path-hash\\}$`),
        );
        expect(resolveCargoBuildDirEnv(withCache, '/repos/checkout-a')).toContainEqual({
            name: 'CARGO_UNSTABLE_BUILD_DIR',
            value: 'true',
        });
    });

    it('keys distinct checkouts apart and the same checkout identically', () => {
        expect(buildDirFor('/repos/checkout-a')).not.toBe(buildDirFor('/repos/checkout-b'));
        expect(buildDirFor('/repos/checkout-a')).toBe(buildDirFor('/repos/checkout-a'));
    });

    it('does nothing when the tool mounts no /cargo-target cache volume', () => {
        const otherVolumes: readonly VolumeMapping[] = [
            { type: 'isolate', containerPath: '/usr/local/cargo', name: 'solana-cargo' },
        ];
        expect(resolveCargoBuildDirEnv(otherVolumes, '/repos/checkout-a')).toEqual([]);
    });

    it('finds the cache volume by containerPath, regardless of its name', () => {
        const renamed: readonly VolumeMapping[] = [
            { type: 'isolate', containerPath: CARGO_TARGET_CACHE_PATH, name: 'custom-target' },
        ];
        expect(buildDirFor('/repos/checkout-a', renamed)).toBeDefined();
    });
});

describe(dockerPlatformProbeStampPath, () => {
    it('stamps image URI and platform under ~/.cache/vm-tooling/probe', () => {
        expect(
            dockerPlatformProbeStampPath(
                '438003944538.dkr.ecr.us-east-1.amazonaws.com/layerzerolabs/vm-tooling-evm:tag',
                'linux/amd64',
            ),
        ).toBe(
            path.join(
                os.homedir(),
                '.cache',
                'vm-tooling',
                'probe',
                '438003944538.dkr.ecr.us-east-1.amazonaws.com_layerzerolabs_vm-tooling-evm_tag_linux_amd64',
            ),
        );
    });
});

describe(mergeToolEnv, () => {
    const cacheEnv: EnvironmentVariable[] = [
        { name: 'CARGO_BUILD_BUILD_DIR', value: `${CARGO_TARGET_CACHE_PATH}/key` },
    ];

    it('keeps the higher-precedence (earlier) layer on a name collision', () => {
        const userEnv: EnvironmentVariable[] = [
            { name: 'CARGO_BUILD_BUILD_DIR', value: '/host/build' },
        ];
        // cacheEnv is passed last (lowest precedence); a user override must survive.
        expect(mergeToolEnv(userEnv, [], [], cacheEnv)).toEqual(userEnv);
    });

    it('applies the cache env only when nothing upstream sets the var', () => {
        expect(mergeToolEnv([], [], [], cacheEnv)).toEqual(cacheEnv);
    });

    it('preserves order and de-dupes across layers', () => {
        expect(
            mergeToolEnv(
                [{ name: 'A', value: '1' }],
                [{ name: 'B', value: '2' }],
                [{ name: 'A', value: 'shadowed' }],
            ),
        ).toEqual([
            { name: 'A', value: '1' },
            { name: 'B', value: '2' },
        ]);
    });
});
