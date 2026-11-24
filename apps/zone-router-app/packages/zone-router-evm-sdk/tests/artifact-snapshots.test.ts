import { generateArtifactSnapshotTests } from '@layerzerolabs/evm-tests-generator/tests/utils';

import { getZoneRouterArtifact, getZoneRouterFactoryArtifact } from '../src/generated-artifacts';

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
    ZoneRouter: {
        artifactGetter: getZoneRouterArtifact,
        evmSnapshot: {
            bytecodeHash: '0xe3cd648a81dd027c0f82c042d7007afd26789aa91fb9f151a99c8209a53af4ae',
            cborMetadata:
                'a2646970667358221220e0f35460415452d0c3efdbc1eb6e746c4742f25bc6f21a37c8b7fb0faa15fbf864736f6c634300081a',
            ...evmSettings,
        },
    },
    ZoneRouterFactory: {
        artifactGetter: getZoneRouterFactoryArtifact,
        evmSnapshot: {
            bytecodeHash: '0x1830d13d6ae7b626b6aef6ee99302583fe3df18a77d19b6ba8f2de30ff894b08',
            cborMetadata:
                'a26469706673582212205aca50c240fa06ca271d03e31ea818a2e33699328de65c7812928601dbbbf4db64736f6c634300081a',
            ...evmSettings,
        },
    },
};

generateArtifactSnapshotTests(snapshots);
