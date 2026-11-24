import z from 'zod';

import { decimalStringSchema, hexSchema } from '@layerzerolabs/common-chain-model';
import { assertUnreachable, NonRetryableError } from '@layerzerolabs/common-error-utils';
import type { Identity } from '@layerzerolabs/typescript-utils';

/**
 * `InitializeDataResult` schema.
 */
export const initializeDataResultSchema = z.object({
    /** Encoded initialization data (e.g., encodeFunctionData for initialize(...)) */
    data: hexSchema,
    /** Optional gas limit override for the initialization transaction */
    gasLimit: decimalStringSchema.optional(),
});

export interface InitializeDataResult
    extends Identity<z.infer<typeof initializeDataResultSchema>> {}

export enum UpgradeType {
    // This doesn't necessarily prevent the contract from being upgraded
    NOT_UPGRADEABLE = 'NOT_UPGRADEABLE',
    // Deploy a separate 'proxy' contract that will route calls to a swappable implementation
    PROXY = 'PROXY',
    // This doesn't necessarily allow the contract to be upgraded
    CODE_UPGRADE = 'CODE_UPGRADE',
}

export enum EvmProxyType {
    // TUP v5 https://docs.openzeppelin.com/contracts/5.x/api/proxy#transparentupgradeableproxy
    TRANSPARENT_UPGRADEABLE_V5 = 'TRANSPARENT_UPGRADEABLE_V5',
    // TUP v5 with `ProxyAdmin2Step` (`Ownable2Step`, no renounce)
    TRANSPARENT_UPGRADEABLE_V5_2STEP = 'TRANSPARENT_UPGRADEABLE_V5_2STEP',
    // UUPS v5 https://docs.openzeppelin.com/contracts/5.x/api/proxy#uupsupgradeable
    UNIVERSAL_UPGRADEABLE_V5 = 'UNIVERSAL_UPGRADEABLE_V5',
    // OTUP v4 https://github.com/wighawag/hardhat-deploy/blob/v0.12.1/solc_0.8/proxy/OptimizedTransparentUpgradeableProxy.sol
    OPTIMIZED_TRANSPARENT_UPGRADEABLE_V4 = 'OPTIMIZED_TRANSPARENT_UPGRADEABLE_V4',
    // TUP v4 https://docs.openzeppelin.com/contracts/4.x/api/proxy#TransparentUpgradeableProxy
    TRANSPARENT_UPGRADEABLE_V4 = 'TRANSPARENT_UPGRADEABLE_V4',
    // UUPS v4 https://docs.openzeppelin.com/contracts/4.x/api/proxy#UUPSUpgradeable
    UNIVERSAL_UPGRADEABLE_V4 = 'UNIVERSAL_UPGRADEABLE_V4',
}

/** UUPS-based proxy types (no separate `ProxyAdmin`). */
export const UUPS_PROXY_TYPES: ReadonlySet<EvmProxyType> = new Set([
    EvmProxyType.UNIVERSAL_UPGRADEABLE_V4,
    EvmProxyType.UNIVERSAL_UPGRADEABLE_V5,
]);

/** TUP-based proxy types (have a `ProxyAdmin` with `getOwner`/`setOwner`). */
export const TUP_PROXY_TYPES: ReadonlySet<EvmProxyType> = new Set([
    EvmProxyType.TRANSPARENT_UPGRADEABLE_V4,
    EvmProxyType.TRANSPARENT_UPGRADEABLE_V5,
    EvmProxyType.TRANSPARENT_UPGRADEABLE_V5_2STEP,
    EvmProxyType.OPTIMIZED_TRANSPARENT_UPGRADEABLE_V4,
]);

/** Proxy types that deploy a separate `ProxyAdmin` contract (v4 variants only). */
export const SEPARATE_PROXY_ADMIN_TYPES: ReadonlySet<EvmProxyType> = new Set([
    EvmProxyType.TRANSPARENT_UPGRADEABLE_V4,
    EvmProxyType.OPTIMIZED_TRANSPARENT_UPGRADEABLE_V4,
]);

/** Whether the proxy type is UUPS (Universal Upgradeable Proxy Standard). */
export const isUupsProxy = (proxyType: EvmProxyType): boolean => UUPS_PROXY_TYPES.has(proxyType);

/** Whether the proxy type is TUP (Transparent Upgradeable Proxy). */
export const isTupProxy = (proxyType: EvmProxyType): boolean => TUP_PROXY_TYPES.has(proxyType);

/** Whether the proxy type requires a separate `ProxyAdmin` deployment (v4 variants). */
export const requiresSeparateProxyAdminDeploy = (proxyType: EvmProxyType): boolean =>
    SEPARATE_PROXY_ADMIN_TYPES.has(proxyType);

export const ProxyType = {
    ...EvmProxyType,
};

export type ProxyType = (typeof ProxyType)[keyof typeof ProxyType];

export const upgradeTypeSchema = z.enum(UpgradeType);

export const proxyTypeSchema = z.enum(ProxyType);
export const proxyConfigSchema = z.object({
    upgradeType: z.literal(UpgradeType.PROXY),
    proxyType: proxyTypeSchema,
});

export type ProxyUpgradeableConfig = z.infer<typeof proxyConfigSchema>;

export const notUpgradeableConfigSchema = z.object({
    upgradeType: z.literal(UpgradeType.NOT_UPGRADEABLE),
});

export type NotUpgradeableConfig = z.infer<typeof notUpgradeableConfigSchema>;

export const codeUpgradeableConfigSchema = z.object({
    upgradeType: z.literal(UpgradeType.CODE_UPGRADE),
});

export type CodeUpgradeableConfig = z.infer<typeof codeUpgradeableConfigSchema>;

export const upgradeableConfigSchema = z.discriminatedUnion('upgradeType', [
    proxyConfigSchema,
    notUpgradeableConfigSchema,
    codeUpgradeableConfigSchema,
]);

export type UpgradeableConfig = z.infer<typeof upgradeableConfigSchema>;

/** @deprecated use assertUpgradability, ensure your config is nonoptional */
export const weakAssertUpgradability = <AllowedUpgradeConfigs extends UpgradeableConfig[]>(
    allowedUpgradeConfigs: AllowedUpgradeConfigs,
    upgradeableConfig?: UpgradeableConfig,
): asserts upgradeableConfig is AllowedUpgradeConfigs[number] => {
    if (!upgradeableConfig) {
        return;
    }

    if (
        allowedUpgradeConfigs.some((allowedConfig) => {
            if (allowedConfig.upgradeType !== upgradeableConfig.upgradeType) {
                return false;
            }

            if (allowedConfig.upgradeType === UpgradeType.NOT_UPGRADEABLE) {
                return true;
            }

            if (allowedConfig.upgradeType === UpgradeType.CODE_UPGRADE) {
                return true;
            }

            if (allowedConfig.upgradeType === UpgradeType.PROXY) {
                return (
                    allowedConfig.proxyType ===
                    (upgradeableConfig as ProxyUpgradeableConfig).proxyType
                );
            }

            assertUnreachable(allowedConfig);
        })
    ) {
        // included in allowed array
        return;
    }

    throw new NonRetryableError(
        `Upgrade config ${JSON.stringify(upgradeableConfig)} is not compatible with any of the allowed upgrade configs ${JSON.stringify(allowedUpgradeConfigs)}`,
    );
};

export const assertUpgradability = <AllowedUpgradeConfigs extends UpgradeableConfig[]>(
    allowedUpgradeConfigs: AllowedUpgradeConfigs,
    // Eventually make this nonoptional once callers are upgraded
    upgradeableConfig?: UpgradeableConfig,
): asserts upgradeableConfig is AllowedUpgradeConfigs[number] => {
    if (!upgradeableConfig) {
        throw new NonRetryableError('Will not handle undefined upgrade config');
    }

    return weakAssertUpgradability(allowedUpgradeConfigs, upgradeableConfig);
};
