import { describe, expect, it, vi } from 'vitest';

const listNamespaceDelegation = vi.hoisted(() => vi.fn());

// Only the topology read client is replaced; request builders and everything else stay real.
vi.mock('@canton-network/core-ledger-proto', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@canton-network/core-ledger-proto')>()),
    TopologyManagerReadServiceClient: class {
        listNamespaceDelegation = listNamespaceDelegation;
    },
}));

import { CantonGrpcClient } from '../../src/client/grpc';
import { computePublicKeyFingerprint } from '../../src/client/utils';

const PUBLIC_KEY = new Uint8Array([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03]);
const FINGERPRINT = computePublicKeyFingerprint(PUBLIC_KEY);

const delegation = (item: Record<string, unknown>) => ({
    item: {
        namespace: FINGERPRINT,
        targetKey: { publicKey: PUBLIC_KEY },
        isRootDelegation: false,
        restriction: { oneofKind: undefined },
        ...item,
    },
    context: { serial: 1 },
});

const getNamespaceDelegation = async (results: unknown[]) => {
    listNamespaceDelegation.mockResolvedValueOnce({ response: { results } });
    const client = new CantonGrpcClient({
        host: 'participant.example.com:5002',
        synchronizerId: 'global::1220ab',
        tokenProvider: { getToken: async () => 'token' } as never,
    });
    return client.getNamespaceDelegation(FINGERPRINT);
};

describe('CantonGrpcClient.getNamespaceDelegation', () => {
    it('treats a canSignAllMappings restriction as a root delegation', async () => {
        const [state] = await getNamespaceDelegation([
            delegation({
                restriction: { oneofKind: 'canSignAllMappings', canSignAllMappings: {} },
            }),
        ]);

        expect(state).toEqual({
            namespace: FINGERPRINT,
            targetKeyFingerprint: FINGERPRINT,
            targetPublicKeyDer: PUBLIC_KEY,
            isRootDelegation: true,
            serial: 1,
        });
    });

    it('still accepts the deprecated isRootDelegation flag', async () => {
        const [state] = await getNamespaceDelegation([delegation({ isRootDelegation: true })]);

        expect(state?.isRootDelegation).toBe(true);
    });

    it('does not treat a restricted delegation as root', async () => {
        const [state] = await getNamespaceDelegation([
            delegation({
                restriction: {
                    oneofKind: 'canSignAllButNamespaceDelegations',
                    canSignAllButNamespaceDelegations: {},
                },
            }),
        ]);

        expect(state?.isRootDelegation).toBe(false);
    });

    it('skips results without a target key', async () => {
        expect(await getNamespaceDelegation([delegation({ targetKey: undefined })])).toEqual([]);
    });
});
