const DEFAULT_OS = 'linux';
const AMD64_ALIASES = new Set(['x86_64', 'x86-64', 'x64', 'amd64']);
const ARM64_ALIASES = new Set(['aarch64', 'arm64']);
const ARM64_DEFAULT_VARIANTS = new Set(['8', 'v8', 'v8.0']);
const ARM64_V9_VARIANTS = new Set(['9', '9.0', 'v9.0']);
const ARM_SHORT_VARIANTS = new Set(['5', '6', '7', '8']);

const normalizeArm64Variant = (variant: string): string => {
    if (ARM64_DEFAULT_VARIANTS.has(variant)) {
        return '';
    }
    return ARM64_V9_VARIANTS.has(variant) ? 'v9' : variant;
};

const normalizeArmVariant = (variant: string): string => {
    if (variant === '') {
        return 'v7';
    }
    return ARM_SHORT_VARIANTS.has(variant) ? `v${variant}` : variant;
};

const normalizeArchitecture = (
    architecture: string,
    variant: string,
): readonly [architecture: string, variant: string] => {
    if (AMD64_ALIASES.has(architecture)) {
        return ['amd64', variant === 'v1' ? '' : variant];
    }
    if (ARM64_ALIASES.has(architecture)) {
        return ['arm64', normalizeArm64Variant(variant)];
    }
    switch (architecture) {
        case 'i386':
            return ['386', ''];
        case 'armhf':
            return ['arm', 'v7'];
        case 'armel':
            return ['arm', 'v6'];
        case 'arm':
            return ['arm', normalizeArmVariant(variant)];
        default:
            return [architecture, variant];
    }
};

const normalizeOs = (os: string): string => (os === 'macos' ? 'darwin' : os);

export const parseDockerPlatform = (input: string): string | undefined => {
    const segments = input.trim().toLowerCase().split('/');
    if (segments.length > 3 || segments.some((segment) => segment === '')) {
        return undefined;
    }

    const [os = '', architecture = '', variant = ''] =
        segments.length === 1 ? [DEFAULT_OS, ...segments] : segments;
    const [normalizedArchitecture, normalizedVariant] = normalizeArchitecture(
        architecture,
        variant,
    );

    return [
        normalizeOs(os),
        normalizedArchitecture,
        ...(normalizedVariant ? [normalizedVariant] : []),
    ].join('/');
};

export const normalizeDockerPlatform = (input: string): string => {
    const platform = parseDockerPlatform(input);

    if (!platform) {
        throw new Error(
            `Invalid Docker platform: ${input}. Expected <os>/<arch>[/<variant>] or <arch>.`,
        );
    }

    return platform;
};
