import { describe, expect, it } from 'vitest';

import {
    buildVerifiableBuildDockerArgs,
    canonicalizeMetaArgs,
    officialImageTagRef,
    parseAmd64Digest,
    resolveBuildDir,
} from '../src/commands/verifiable-build';

const AMD64_DIGEST = 'sha256:dd2ec7b637194a357eff45f696ff3e077a5d1070c3bf923fcacd54af5c6d2b4f';

// Shape of `docker manifest inspect <multi-arch tag>`: amd64 + arm64 plus the two unknown/unknown
// attestation entries that must be ignored.
const MANIFEST_INSPECT_JSON = JSON.stringify({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: [
        { digest: AMD64_DIGEST, platform: { architecture: 'amd64', os: 'linux' } },
        { digest: 'sha256:aaaa', platform: { architecture: 'arm64', os: 'linux' } },
        { digest: 'sha256:bbbb', platform: { architecture: 'unknown', os: 'unknown' } },
        { digest: 'sha256:cccc', platform: { architecture: 'unknown', os: 'unknown' } },
    ],
});

describe('officialImageTagRef', () => {
    it('builds the <stellar>-rust<rust>-slim-bookworm tag from the pinned versions', () => {
        expect(officialImageTagRef('25.1.0', '1.90.0')).toBe(
            'stellar/stellar-cli:25.1.0-rust1.90.0-slim-bookworm',
        );
    });
});

describe('parseAmd64Digest', () => {
    it('selects the linux/amd64 manifest digest', () => {
        expect(parseAmd64Digest(MANIFEST_INSPECT_JSON)).toBe(AMD64_DIGEST);
    });

    it('throws when there is no linux/amd64 manifest', () => {
        const json = JSON.stringify({
            manifests: [
                { digest: 'sha256:aaaa', platform: { architecture: 'arm64', os: 'linux' } },
            ],
        });
        expect(() => parseAmd64Digest(json)).toThrow(/No linux\/amd64 manifest digest/);
    });

    it('throws when the output is not a multi-arch index', () => {
        expect(() => parseAmd64Digest(JSON.stringify({ mediaType: 'single' }))).toThrow(
            /multi-arch index/,
        );
    });
});

describe('resolveBuildDir', () => {
    it('defaults to the cwd when no source dir is given', () => {
        expect(resolveBuildDir('/work/pkg')).toBe('/work/pkg');
    });

    it('resolves a relative source dir against the cwd', () => {
        expect(resolveBuildDir('/work/pkg', 'extracted')).toBe('/work/pkg/extracted');
        expect(resolveBuildDir('/work/pkg', './build/out')).toBe('/work/pkg/build/out');
    });

    it('uses an absolute source dir as-is', () => {
        expect(resolveBuildDir('/work/pkg', '/tmp/extracted-source')).toBe('/tmp/extracted-source');
    });
});

describe('canonicalizeMetaArgs', () => {
    it('sorts injected + user --meta entries and keeps non-meta args first', () => {
        expect(
            canonicalizeMetaArgs(
                ['--package', 'x', '--meta', 'zzz=1', '--optimize', '--meta', 'aaa=2'],
                ['bldimg=img'],
            ),
        ).toEqual([
            '--package',
            'x',
            '--optimize',
            '--meta',
            'aaa=2',
            '--meta',
            'bldimg=img',
            '--meta',
            'zzz=1',
        ]);
    });

    it('is independent of the order the --meta flags were passed', () => {
        const a = canonicalizeMetaArgs(['--meta', 'b=2', '--meta', 'a=1'], ['bldimg=img']);
        const b = canonicalizeMetaArgs(['--meta', 'a=1', '--meta', 'b=2'], ['bldimg=img']);
        expect(a).toEqual(b);
    });

    it('recognizes the --meta=k=v form', () => {
        expect(canonicalizeMetaArgs(['--meta=source_sha256=abc'], ['bldimg=img'])).toEqual([
            '--meta',
            'bldimg=img',
            '--meta',
            'source_sha256=abc',
        ]);
    });

    it('drops a dangling --meta with no value', () => {
        expect(canonicalizeMetaArgs(['--package', 'x', '--meta'], ['bldimg=img'])).toEqual([
            '--package',
            'x',
            '--meta',
            'bldimg=img',
        ]);
    });

    it('drops a --meta immediately followed by another flag', () => {
        expect(canonicalizeMetaArgs(['--meta', '--optimize'], ['bldimg=img'])).toEqual([
            '--optimize',
            '--meta',
            'bldimg=img',
        ]);
    });

    it('drops a caller --meta that collides with an injected (reserved) key', () => {
        // A caller cannot override the tool-controlled bldimg by reusing the key.
        expect(
            canonicalizeMetaArgs(
                ['--meta', 'bldimg=evil', '--meta', 'source_sha256=ok'],
                ['bldimg=real'],
            ),
        ).toEqual(['--meta', 'bldimg=real', '--meta', 'source_sha256=ok']);
    });

    it('drops a reserved-key collision in the --meta=k=v form too', () => {
        expect(canonicalizeMetaArgs(['--meta=bldimg=evil'], ['bldimg=real'])).toEqual([
            '--meta',
            'bldimg=real',
        ]);
    });
});

describe('buildVerifiableBuildDockerArgs', () => {
    const imageRef = `stellar/stellar-cli@${AMD64_DIGEST}`;
    const bldimg = `docker.io/stellar/stellar-cli@${AMD64_DIGEST}`;

    it('mounts the self-contained source at /source and embeds the bldimg meta', () => {
        const args = buildVerifiableBuildDockerArgs({
            imageRef,
            sourceDir: '/tmp/extracted-source',
            buildArgs: ['--package', 'ethena-oft', '--optimize'],
            bldimg,
        });

        expect(args).toEqual([
            'run',
            '--rm',
            '--platform',
            'linux/amd64',
            '-v',
            '/tmp/extracted-source:/source',
            '-w',
            '/source',
            imageRef,
            'contract',
            'build',
            '--package',
            'ethena-oft',
            '--optimize',
            '--meta',
            `bldimg=${bldimg}`,
        ]);
    });

    it('runs the image by digest and always appends the tool-injected bldimg meta', () => {
        const args = buildVerifiableBuildDockerArgs({
            imageRef,
            sourceDir: '/src',
            buildArgs: [],
            bldimg,
        });

        // Image reference is pinned by digest, not a mutable tag.
        expect(args).toContain(imageRef);
        expect(imageRef).toContain('@sha256:');
        // With no user metas, the injected bldimg is the sole (last) meta.
        expect(args.slice(-2)).toEqual(['--meta', `bldimg=${bldimg}`]);
    });

    it('sorts the caller --meta flags together with the injected bldimg meta', () => {
        const args = buildVerifiableBuildDockerArgs({
            imageRef,
            sourceDir: '/src',
            buildArgs: ['--package', 'p', '--meta', 'source_sha256=zzz'],
            bldimg,
        });

        // bldimg=docker.io/... sorts before source_sha256=zzz; non-meta args stay ahead of the metas.
        expect(args.slice(args.indexOf('build') + 1)).toEqual([
            '--package',
            'p',
            '--meta',
            `bldimg=${bldimg}`,
            '--meta',
            'source_sha256=zzz',
        ]);
    });
});
