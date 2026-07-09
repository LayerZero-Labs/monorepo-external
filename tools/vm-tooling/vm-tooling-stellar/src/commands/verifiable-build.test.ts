import { describe, expect, it } from 'vitest';

import {
    buildVerifiableBuildDockerArgs,
    officialImageTagRef,
    parseAmd64Digest,
} from './verifiable-build';

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

describe('buildVerifiableBuildDockerArgs', () => {
    const imageRef = `stellar/stellar-cli@${AMD64_DIGEST}`;
    const bldimg = `docker.io/stellar/stellar-cli@${AMD64_DIGEST}`;

    it('mounts the self-contained source at /source and embeds the bldimg meta', () => {
        const args = buildVerifiableBuildDockerArgs({
            imageRef,
            sourceDir: '/tmp/extracted-source',
            buildArgs: ['--package', 'ethena-oft-oft', '--optimize'],
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
            'ethena-oft-oft',
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
        // bldimg is the last meta appended, regardless of user args.
        expect(args.slice(-2)).toEqual(['--meta', `bldimg=${bldimg}`]);
    });
});
