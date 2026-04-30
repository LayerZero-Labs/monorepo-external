export enum PackageNameCaseOption {
    PASCAL = 'pascal',
    KEBAB = 'kebab',
    TITLE = 'title',
    CAMEL = 'camel',
    UPPER = 'upper',
    SNAKE = 'snake',
}

/**
 * Generates a camelCase name from the package name by default.
 *
 * @param packageName - The name of the package.
 * @param caseOption - Optional `PackageNameCaseOption` controlling the output casing
 *  (PASCAL, KEBAB, TITLE, CAMEL, UPPER, SNAKE). Defaults to camelCase when omitted.
 * @returns The package name.
 */
export const generatePackageName = (
    packageName: string,
    caseOption?: PackageNameCaseOption,
): string => {
    const sanitizedPackageName = packageName.toLowerCase().replace(/[^a-z0-9-]/g, '');

    if (caseOption === PackageNameCaseOption.SNAKE) {
        return sanitizedPackageName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    }

    if (caseOption === PackageNameCaseOption.KEBAB) {
        return sanitizedPackageName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    }

    if (caseOption === PackageNameCaseOption.UPPER) {
        return sanitizedPackageName.replace(/(-)/g, '_').toUpperCase();
    }

    const name = sanitizedPackageName.replace(/(-)(\w)/g, (_, __, c) => c.toUpperCase());

    if (caseOption === PackageNameCaseOption.CAMEL) {
        return name.charAt(0).toLowerCase() + name.slice(1);
    }

    if (caseOption === PackageNameCaseOption.PASCAL) {
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    if (caseOption === PackageNameCaseOption.TITLE) {
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    return name;
};

/**
 * Sanitizes the package name by removing the suffixes from the name parts if present (case-insensitive).
 * @param packageName - The name of the package.
 * @param suffix - The suffixes to remove from the package name.
 * @returns The sanitized package name.
 */
export const sanitizePackageName = (packageName: string, suffix: string): string => {
    const suffixesToRemove = suffix.split('-');
    packageName = packageName.toLowerCase();

    let parts = packageName.split('-');

    // Remove suffixes from the name parts if present (case-insensitive)
    parts = parts.filter((part) => !suffixesToRemove.includes(part.toLowerCase()));

    packageName = parts.join('-');

    return packageName;
};
