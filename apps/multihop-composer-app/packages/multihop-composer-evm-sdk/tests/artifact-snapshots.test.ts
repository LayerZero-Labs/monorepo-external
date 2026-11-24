import { generateArtifactSnapshotTests } from '@layerzerolabs/evm-tests-generator/tests/utils';

import {
    getMultiHopComposerArtifact,
    getMultiHopComposerNativeArtifact,
} from '../src/generated-artifacts';

const evmSettings = {
    solcVersion: '0.8.26',
    compiler: {
        evmVersion: 'cancun',
        viaIR: true,
        optimizer: { enabled: true, runs: 20_000 },
        metadata: { useLiteralContent: true },
    },
};

/**
 * Snapshot values sourced from this repository.
 */
const snapshots = {
    MultiHopComposer: {
        artifactGetter: getMultiHopComposerArtifact,
        evmSnapshot: {
            bytecodeHash: '0x1c7d23afe41ec2a0bfbb8f376c94b3761c9d6178ca48786b29435919af9e99b4',
            cborMetadata:
                'a26469706673582212202e51ab7ded2cddc110652c0e53b53ee82eda7c6b9caa623def4f1c501a4a9e9364736f6c634300081a',
            ...evmSettings,
        },
    },
    MultiHopComposerNative: {
        artifactGetter: getMultiHopComposerNativeArtifact,
        evmSnapshot: {
            bytecodeHash: '0xd92ac44b5890c666c740fbb767885bb70f36d581848727d3f98f081bcdf0efe2',
            cborMetadata:
                'a264697066735822122040ad71786704248d6deafa96b6cdd36be5774764e1a0c61c8107264a881e8ffd64736f6c634300081a',
            ...evmSettings,
        },
    },
};

generateArtifactSnapshotTests(snapshots);
