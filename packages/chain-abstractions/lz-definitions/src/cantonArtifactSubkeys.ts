/**
 * Artifact registry subkeys for Canton endpoint-v2 multi-contract deploys.
 */
export const CANTON_ENDPOINT_ARTIFACT_SUBKEYS = {
    REQUEST_FACTORY: 'requestFactory',
    REQUEST_FACTORY_CONFIG: 'requestFactoryConfig',
    COMMITTER: 'committer',
    DISCOVERY_REGISTRY: 'discoveryRegistry',
    REQUEST_FACTORY_ACCESS_CONTROL: 'requestFactoryAccessControl',
    DISCOVERY_REGISTRY_ACCESS_CONTROL: 'discoveryRegistryAccessControl',
} as const;
