import { describe, expect, it } from 'vitest';

import type { EnvironmentVariable, VolumeMapping } from '../config';
import { CARGO_TARGET_CACHE_PATH } from '../config';
import { mergeToolEnv, resolveCargoCacheEnv } from './tool-executor';

const cacheVolume: VolumeMapping = {
    type: 'isolate',
    containerPath: CARGO_TARGET_CACHE_PATH,
    name: 'solana-target',
};

const withCache: readonly VolumeMapping[] = [cacheVolume];
const cacheEnv = [{ name: 'CARGO_TARGET_DIR', value: CARGO_TARGET_CACHE_PATH }];

describe(resolveCargoCacheEnv, () => {
    describe('cache-safe scripts redirect at the shared cache', () => {
        it.each([
            'cargo test -p anchor-trait --lib --tests',
            'cargo test --manifest-path macros/examples/vault/Cargo.toml --lib --tests',
            'cargo test -p rbac --test trybuild -- --ignored',
            'cargo test --package onesig -- tests --nocapture',
            'cargo test-ellipse',
            'cargo test-triangle',
            'cargo check',
            'cargo nextest run',
            'cargo +nightly-2025-06-01 fmt -- --check && cargo clippy --all-targets',
            // builtin t=test / c=check aliases.
            'cargo t',
            'cargo c',
            'cargo +nightly-2025-06-01 t --lib',
        ])('%s', (script) => {
            expect(resolveCargoCacheEnv(script, withCache)).toEqual(cacheEnv);
        });
    });

    describe('artifact-producing builds are never redirected', () => {
        it.each([
            'anchor build --no-idl --ignore-keys',
            'cargo build',
            'cargo build-sbf',
            // test-sbf/test-bpf build .so despite the `test-` prefix.
            'cargo test-sbf',
            'cargo test-bpf --features foo',
            // Dashed binary forms (the real protocol `test` script is `cargo-test-sbf`) — the
            // space-anchored cargo branch misses these, so they need their own alternative.
            'cargo-test-sbf',
            'cargo-build-sbf',
            'cargo-build-bpf --features x',
        ])('%s', (script) => {
            expect(resolveCargoCacheEnv(script, withCache)).toEqual([]);
        });

        it('skips when a build and a test share one script (build half must reach the host)', () => {
            expect(resolveCargoCacheEnv('cargo build && cargo test', withCache)).toEqual([]);
            expect(resolveCargoCacheEnv('anchor build && cargo test --lib', withCache)).toEqual([]);
            // builtin b=build alias must still defeat the redirect when paired with a test.
            expect(resolveCargoCacheEnv('cargo b && cargo test', withCache)).toEqual([]);
            expect(resolveCargoCacheEnv('cargo b && cargo t', withCache)).toEqual([]);
            // `anchor idl build` emits host IDL JSON — must defeat the redirect like any build.
            expect(
                resolveCargoCacheEnv('cargo test --lib && anchor idl build -o x.json', withCache),
            ).toEqual([]);
            // Dashed sbf binary glued to a cache-safe verb must still defeat the redirect.
            expect(resolveCargoCacheEnv('cargo test --lib && cargo-build-sbf', withCache)).toEqual(
                [],
            );
            // `anchor test` builds the program + IDL before running, and `cargo rustc` compiles —
            // both must defeat the redirect when paired with a cache-safe verb.
            expect(resolveCargoCacheEnv('anchor test && cargo test --lib', withCache)).toEqual([]);
            expect(
                resolveCargoCacheEnv('cargo rustc -- --emit=obj && cargo test', withCache),
            ).toEqual([]);
        });

        // The build must be detected even when glued straight to a shell separator with no space
        // (`;`, `&&`) — otherwise the build half silently redirects its .so/IDL into the cache.
        it.each([
            'cargo build; cargo test',
            'cargo build&&cargo test',
            'cargo build-sbf;cargo test',
            'cargo b;cargo test',
            'cargo b&&cargo t',
        ])('%s', (script) => {
            expect(resolveCargoCacheEnv(script, withCache)).toEqual([]);
        });
    });

    describe('commands outside the cache-safe allowlist are not redirected', () => {
        it.each(['cargo +nightly-2025-06-01 fmt', 'cargo +nightly-2025-06-01 fmt -- --check'])(
            '%s',
            (script) => {
                expect(resolveCargoCacheEnv(script, withCache)).toEqual([]);
            },
        );
    });

    it('does nothing when the tool mounts no /cargo-target cache volume', () => {
        const otherVolumes: readonly VolumeMapping[] = [
            { type: 'isolate', containerPath: '/usr/local/cargo', name: 'solana-cargo' },
        ];
        expect(resolveCargoCacheEnv('cargo test -p oft --lib --tests', otherVolumes)).toEqual([]);
    });

    it('returns nothing for an empty or absent script (non --script invocations)', () => {
        expect(resolveCargoCacheEnv(undefined, withCache)).toEqual([]);
        expect(resolveCargoCacheEnv('', withCache)).toEqual([]);
    });

    it('does not match cargo substrings inside other words', () => {
        expect(resolveCargoCacheEnv('mycargo testlike', withCache)).toEqual([]);
    });

    it('tolerates irregular whitespace around the command', () => {
        // \s+ / \b mean extra spaces, tabs, and leading whitespace do not defeat matching.
        expect(resolveCargoCacheEnv('  cargo   test --lib', withCache)).toEqual(cacheEnv);
        expect(resolveCargoCacheEnv('cargo\ttest', withCache)).toEqual(cacheEnv);
        // ...and the build exclusion is equally whitespace-insensitive.
        expect(resolveCargoCacheEnv('cargo   build  &&  cargo test', withCache)).toEqual([]);
    });

    it('finds the cache volume by containerPath, regardless of its name', () => {
        // Lookup is keyed on the mount path, not the 'solana-target' name — any isolate volume
        // mounted at the cache path triggers the redirect.
        const renamed: readonly VolumeMapping[] = [
            { type: 'isolate', containerPath: CARGO_TARGET_CACHE_PATH, name: 'custom-target' },
        ];
        expect(resolveCargoCacheEnv('cargo test', renamed)).toEqual([
            { name: 'CARGO_TARGET_DIR', value: CARGO_TARGET_CACHE_PATH },
        ]);
    });
});

describe(mergeToolEnv, () => {
    const cacheEnv: EnvironmentVariable[] = [
        { name: 'CARGO_TARGET_DIR', value: CARGO_TARGET_CACHE_PATH },
    ];

    it('keeps the higher-precedence (earlier) layer on a name collision', () => {
        const userEnv: EnvironmentVariable[] = [
            { name: 'CARGO_TARGET_DIR', value: '/host/target' },
        ];
        // cacheEnv is passed last (lowest precedence); a user override must survive.
        expect(mergeToolEnv(userEnv, [], [], cacheEnv)).toEqual(userEnv);
    });

    it('applies the cache redirect only when nothing upstream sets the var', () => {
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
