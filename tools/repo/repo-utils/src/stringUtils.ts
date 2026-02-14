export enum PackageNameCaseOption {
    PASCAL_CASE = 'pascalCase',
    KEBAB_CASE = 'kebabCase',
    TITLE_CASE = 'titleCase',
    CAMEL_CASE = 'camelCase',
    UPPER_CASE = 'upperCase',
    SNAKE_CASE = 'snakeCase',
}

/**
 * Generates a camelCase name from the package name by default.
 *
 * @param packageName - The name of the package.
 * @param options - The options for the package name.
 *  - pascalCase: Whether to capitalize the first letter of the name. Default is false.
 *  - kebabCase: Whether to convert the name to kebab case. Default is false.
 *
 * @returns The package name.
 */
export const generatePackageName = (
    packageName: string,
    caseOption?: PackageNameCaseOption,
): string => {
    const sanitizedPackageName = packageName.toLowerCase().replace(/[^a-z0-9-]/g, '');

    if (caseOption === PackageNameCaseOption.SNAKE_CASE) {
        return sanitizedPackageName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    }

    if (caseOption === PackageNameCaseOption.KEBAB_CASE) {
        return sanitizedPackageName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    }

    if (caseOption === PackageNameCaseOption.UPPER_CASE) {
        return sanitizedPackageName.replace(/(-)/g, '_').toUpperCase();
    }

    const name = sanitizedPackageName.replace(/(-)(\w)/g, (_, __, c) => c.toUpperCase());

    if (caseOption === PackageNameCaseOption.CAMEL_CASE) {
        return name.charAt(0).toLowerCase() + name.slice(1);
    }

    if (caseOption === PackageNameCaseOption.PASCAL_CASE) {
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    if (caseOption === PackageNameCaseOption.TITLE_CASE) {
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
