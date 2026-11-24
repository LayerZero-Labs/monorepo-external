import { generateArtifactSnapshotTests } from '@layerzerolabs/evm-tests-generator/tests/utils';

import { getZoneComposerArtifact, getZoneComposerNativeArtifact } from '../src/generated-artifacts';

const evmSettings = {
    solcVersion: '0.8.26',
    compiler: {
        evmVersion: 'cancun',
        viaIR: true,
        optimizer: { enabled: true, runs: 34_000 },
        metadata: { useLiteralContent: true },
    },
};

const snapshots = {
    ZoneComposer: {
        artifactGetter: getZoneComposerArtifact,
        evmSnapshot: {
            bytecodeHash: '0x280ed0e95a97c8d29e96b59612ab5f589fb3cf6cbd5d616ec5cb0218a7fd131b',
            cborMetadata:
                'a2646970667358221220cccfa6b1ff94564cbdd4dde8d58d037f26108383156e9dac15345dd79c55b18c64736f6c634300081a',
            ...evmSettings,
        },
    },
    ZoneComposerNative: {
        artifactGetter: getZoneComposerNativeArtifact,
        evmSnapshot: {
            bytecodeHash: '0xa43abfc42b9a6df09d948d987124bc793e1d661be928f6039c69292bf33970f8',
            cborMetadata:
                'a2646970667358221220b05e4c32b817f5dc433f89689e2dc952a30865141c8b1fabc888e72ab98ddddf64736f6c634300081a',
            ...evmSettings,
        },
    },
};

generateArtifactSnapshotTests(snapshots);
