import { describe, expect, it, vi } from 'vitest';

import { sentinelNormalizedFromLabel } from '@layerzerolabs/chain-utils';
import { NonRetryableError } from '@layerzerolabs/common-error-utils';
import { ChainName } from '@layerzerolabs/layerzero-definitions';

import {
    bindGetResourceSet,
    createCompositeResourceRef,
    getResourceSet,
    isCompositeResourceIdInScope,
    listEntryFromCompositeRef,
    type RealId,
    type ResourceRegistry,
} from '../src';

const RESOURCE_ID = 'my-example-oft-mint-burn-solana-devnet';

const identityAddress = sentinelNormalizedFromLabel(ChainName.ETHEREUM, 'aa');
const implAddress = sentinelNormalizedFromLabel(ChainName.ETHEREUM, 'bb');
const factoryAddress = sentinelNormalizedFromLabel(ChainName.ETHEREUM, 'dd');

const createInMemoryResourceRegistry = (): ResourceRegistry => {
    const store = new Map<string, RealId>();

    const getResourceRealId: ResourceRegistry['getResourceRealId'] = async ({ ref }) =>
        store.get(createCompositeResourceRef(ref));

    const listResourceRealIds: ResourceRegistry['listResourceRealIds'] = async (args) => {
        const scopeResourceId = args?.resourceId;
        return [...store.entries()]
            .filter(
                ([compositeRef]) =>
                    scopeResourceId == null ||
                    isCompositeResourceIdInScope({
                        compositeRef,
                        resourceId: scopeResourceId,
                    }),
            )
            .map(([compositeRef, realId]) => listEntryFromCompositeRef(compositeRef, realId));
    };

    return {
        getResourceRealId,
        upsertResourceRealId: async ({ ref, realId }) => {
            store.set(createCompositeResourceRef(ref), realId);
        },
        deleteResourceRealId: async ({ ref }) => {
            store.delete(createCompositeResourceRef(ref));
        },
        listResourceRealIds,
        getResourceSet: bindGetResourceSet({ getResourceRealId, listResourceRealIds }),
    };
};

describe('getResourceSet', () => {
    it('returns the identity RealID and empty subkeys when no subkeys are registered', async () => {
        const registry = createInMemoryResourceRegistry();
        await registry.upsertResourceRealId({
            ref: { resourceId: RESOURCE_ID },
            realId: { realIdKey: identityAddress, chainName: ChainName.ETHEREUM },
        });

        const getResourceRealId = vi.spyOn(registry, 'getResourceRealId');
        const set = await getResourceSet({ resourceId: RESOURCE_ID, resourceRegistry: registry });

        expect(set.address).toBe(identityAddress);
        expect(set.subkeys).toEqual({});
        expect(getResourceRealId).toHaveBeenCalledWith({ ref: { resourceId: RESOURCE_ID } });
    });

    it('discovers subkeys from structured listResourceRealIds rows', async () => {
        const registry = createInMemoryResourceRegistry();
        await registry.upsertResourceRealId({
            ref: { resourceId: RESOURCE_ID },
            realId: { realIdKey: identityAddress, chainName: ChainName.ETHEREUM },
        });
        await registry.upsertResourceRealId({
            ref: { resourceId: RESOURCE_ID, resourceSubKey: 'impl' },
            realId: { realIdKey: implAddress, chainName: ChainName.ETHEREUM },
        });
        await registry.upsertResourceRealId({
            ref: { resourceId: RESOURCE_ID, resourceSubKey: 'factory' },
            realId: { realIdKey: factoryAddress, chainName: ChainName.ETHEREUM },
        });

        const listSpy = vi.spyOn(registry, 'listResourceRealIds');
        const listed = await registry.listResourceRealIds({ resourceId: RESOURCE_ID });
        expect(listed).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    resourceId: RESOURCE_ID,
                    realId: expect.objectContaining({ realIdKey: identityAddress }),
                }),
                expect.objectContaining({
                    resourceId: RESOURCE_ID,
                    resourceSubKey: 'impl',
                    realId: expect.objectContaining({ realIdKey: implAddress }),
                }),
                expect.objectContaining({
                    resourceId: RESOURCE_ID,
                    resourceSubKey: 'factory',
                    realId: expect.objectContaining({ realIdKey: factoryAddress }),
                }),
            ]),
        );
        expect(listed.every((entry) => !entry.resourceId.includes('/'))).toBe(true);

        const set = await getResourceSet({ resourceId: RESOURCE_ID, resourceRegistry: registry });

        expect(listSpy).toHaveBeenCalledWith({ resourceId: RESOURCE_ID });
        expect(set.address).toBe(identityAddress);
        expect(set.subkeys).toEqual({
            impl: implAddress,
            factory: factoryAddress,
        });
    });

    it('does not discover subkeys from a resourceId that only shares a string prefix', async () => {
        const registry = createInMemoryResourceRegistry();
        await registry.upsertResourceRealId({
            ref: { resourceId: RESOURCE_ID },
            realId: { realIdKey: identityAddress, chainName: ChainName.ETHEREUM },
        });
        await registry.upsertResourceRealId({
            ref: { resourceId: `${RESOURCE_ID}-v2`, resourceSubKey: 'factory' },
            realId: { realIdKey: factoryAddress, chainName: ChainName.ETHEREUM },
        });

        const set = await getResourceSet({ resourceId: RESOURCE_ID, resourceRegistry: registry });

        expect(set.subkeys).toEqual({});
    });

    it('discovers structured resourceSubKey entries from listResourceRealIds', async () => {
        const listResourceRealIds = vi.fn(async () => [
            {
                resourceId: RESOURCE_ID,
                realId: { realIdKey: identityAddress, chainName: ChainName.ETHEREUM },
            },
            {
                resourceId: RESOURCE_ID,
                resourceSubKey: 'factory',
                realId: { realIdKey: factoryAddress, chainName: ChainName.ETHEREUM },
            },
        ]);
        const registry = {
            getResourceRealId: async ({
                ref,
            }: {
                ref: { resourceId: string; resourceSubKey?: string };
            }) => {
                if (ref.resourceSubKey != null) {
                    return undefined;
                }
                if (ref.resourceId !== RESOURCE_ID) {
                    return undefined;
                }
                return { realIdKey: identityAddress, chainName: ChainName.ETHEREUM };
            },
            listResourceRealIds,
        };

        const set = await getResourceSet({ resourceId: RESOURCE_ID, resourceRegistry: registry });

        expect(listResourceRealIds).toHaveBeenCalledWith({ resourceId: RESOURCE_ID });
        expect(set.address).toBe(identityAddress);
        expect(set.subkeys).toEqual({ factory: factoryAddress });
    });

    it('joins through ResourceRegistry.getResourceSet binder', async () => {
        const registry = createInMemoryResourceRegistry();
        await registry.upsertResourceRealId({
            ref: { resourceId: RESOURCE_ID },
            realId: { realIdKey: identityAddress, chainName: ChainName.ETHEREUM },
        });
        await registry.upsertResourceRealId({
            ref: { resourceId: RESOURCE_ID, resourceSubKey: 'impl' },
            realId: { realIdKey: implAddress, chainName: ChainName.ETHEREUM },
        });

        const set = await registry.getResourceSet(RESOURCE_ID);

        expect(set.address).toBe(identityAddress);
        expect(set.subkeys.impl).toBe(implAddress);
    });

    it('throws NonRetryableError when the identity RealID is missing', async () => {
        const registry = createInMemoryResourceRegistry();
        await expect(
            getResourceSet({ resourceId: RESOURCE_ID, resourceRegistry: registry }),
        ).rejects.toSatisfy(
            (err: unknown) =>
                err instanceof NonRetryableError &&
                err.message === `No realId for resourceId "${RESOURCE_ID}"`,
        );
    });

    it('throws NonRetryableError when the identity realIdKey is not normalized hex', async () => {
        const registry = createInMemoryResourceRegistry();
        await registry.upsertResourceRealId({
            ref: { resourceId: RESOURCE_ID },
            realId: { realIdKey: 'not-a-normalized-hex', chainName: ChainName.ETHEREUM },
        });

        await expect(
            getResourceSet({ resourceId: RESOURCE_ID, resourceRegistry: registry }),
        ).rejects.toSatisfy(
            (err: unknown) =>
                err instanceof NonRetryableError &&
                /not normalized hex/.test(err.message) &&
                /not native/.test(err.message),
        );
    });

    it('throws NonRetryableError when a subkey realIdKey is not normalized hex', async () => {
        const registry = createInMemoryResourceRegistry();
        await registry.upsertResourceRealId({
            ref: { resourceId: RESOURCE_ID },
            realId: { realIdKey: identityAddress, chainName: ChainName.ETHEREUM },
        });
        await registry.upsertResourceRealId({
            ref: { resourceId: RESOURCE_ID, resourceSubKey: 'impl' },
            realId: { realIdKey: 'not-a-normalized-hex', chainName: ChainName.ETHEREUM },
        });

        await expect(
            getResourceSet({ resourceId: RESOURCE_ID, resourceRegistry: registry }),
        ).rejects.toSatisfy(
            (err: unknown) => err instanceof NonRetryableError && /not native/.test(err.message),
        );
    });

    it('rejects empty resourceId', async () => {
        const registry = createInMemoryResourceRegistry();
        await expect(
            getResourceSet({ resourceId: '', resourceRegistry: registry }),
        ).rejects.toSatisfy(
            (err: unknown) =>
                err instanceof NonRetryableError && /non-empty resourceId/.test(err.message),
        );
    });

    it('rejects resourceId that includes a slash', async () => {
        const registry = createInMemoryResourceRegistry();
        await expect(
            getResourceSet({
                resourceId: `${RESOURCE_ID}/factory`,
                resourceRegistry: registry,
            }),
        ).rejects.toSatisfy(
            (err: unknown) =>
                err instanceof NonRetryableError && /subkey-qualified ref/.test(err.message),
        );
    });
});
