import { z } from 'zod';

import { normalizedHexSchema } from '@layerzerolabs/common-chain-model';

/**
 * Identity RealID key plus all known subkey RealID keys for one resourceId.
 *
 * `subkeys[k]` corresponds to `resourceRef.resourceSubKey === k`
 * (e.g. `factory`, `impl`, `proxy-admin`).
 * `getResourceSet` always returns a `subkeys` record (possibly `{}`).
 */
export const resourceSetSchema = z.object({
    address: normalizedHexSchema,
    subkeys: z.record(z.string(), normalizedHexSchema),
});

export type ResourceSet = z.infer<typeof resourceSetSchema>;

/**
 * Specialization of a wiring activity factory: the ResourceSet of the resource it operates on.
 * Impls read the identity address and, where their VM keeps sibling contracts as subkeys, the
 * subkeys they own. `subkeys` is optional so callers that only know an identity address (code
 * outside the resource model) can still specialize; an impl that needs a subkey fails loudly
 * when it is missing.
 */
export const resourceSetSpecSchema = z.object({
    address: normalizedHexSchema,
    subkeys: z.record(z.string(), normalizedHexSchema).optional(),
});

export type ResourceSetSpec = z.infer<typeof resourceSetSpecSchema>;
