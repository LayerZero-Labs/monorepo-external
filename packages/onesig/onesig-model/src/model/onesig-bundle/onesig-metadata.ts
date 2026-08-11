import { z } from 'zod';

/**
 * Bundle-level metadata as submitted by the proposer.
 *
 * The keys below are everything the OneSig client writes at propose time —
 * the closed set of expected metadata. Flat scalars only; oversized metadata
 * is rejected at upload (100KB cap in oneSigV3Controller).
 *
 * HARD REQUIREMENT: once accepted, validation must never strip, reject, or
 * coerce metadata — the proposer signature commits to the raw metadata object
 * (see `getStringifiedOneSigBundle` in onesig-v3-utils), so altering it
 * during validation breaks proposer-signature recovery. This is why
 * {@link oneSigBundleMetadataSchema} is a non-validating `z.custom`.
 */
export interface OneSigBundleMetadata {
    /** Human-readable bundle description, shown in bundle lists (capital-D by client convention). */
    Description?: string;
    /** Name of the OneSig config the bundle was proposed against. */
    configName?: string;
}

/**
 * Non-enforcing schema for {@link OneSigBundleMetadata}: types the field and
 * documents the expected keys, but validates nothing. Do NOT replace with a
 * validating object schema — see the hard requirement on the interface.
 *
 * The `.meta()` is required so OpenAPI/JSON-Schema generation (e.g. the
 * oapp-operations API spec build, via zod-openapi) can represent the field —
 * `z.custom` alone is unrepresentable and fails that build. It affects
 * introspection only; parse behavior is unchanged.
 */
export const oneSigBundleMetadataSchema = z.custom<OneSigBundleMetadata>().meta({
    type: 'object',
    properties: {
        Description: {
            type: 'string',
            description: 'Human-readable bundle description, shown in bundle lists',
        },
        configName: {
            type: 'string',
            description: 'Name of the OneSig config the bundle was proposed against',
        },
    },
    additionalProperties: false,
    description:
        'Bundle metadata as submitted by the proposer. Flat, closed key set: Description (string), configName (string). Rejected at upload when larger than 100KB.',
});
