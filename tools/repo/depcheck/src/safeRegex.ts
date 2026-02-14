/**
 * Helper function to safely match a pattern against a string, with optional regex support.
 * If regex compilation fails, it falls back to a simple partial match.
 */
export const safeRegexMatch = (params: {
    str: string;
    pattern: string;
    useRegex?: boolean;
}): boolean => {
    const { str, pattern, useRegex = true } = params;
    if (!useRegex) {
        return str === pattern;
    }
    try {
        // If pattern is intended as regex, use as-is
        const regex = new RegExp(pattern);
        return regex.test(str);
    } catch (_error) {
        // If regex fails to compile, fall back to partial match
        return str.includes(pattern);
    }
};
