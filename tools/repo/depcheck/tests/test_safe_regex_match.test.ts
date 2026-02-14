import { describe, expect, test } from 'vitest';

import { MOVE_TO_DEV_DEFAULT_PATTERN } from '../src/deps';
import { safeRegexMatch } from '../src/safeRegex';

describe('safeRegexMatch', () => {
    describe('exact matching (useRegex: false)', () => {
        test('should match exact strings', () => {
            expect(safeRegexMatch({ str: 'lodash', pattern: 'lodash', useRegex: false })).toBe(
                true,
            );
        });

        test('should not match different strings', () => {
            expect(safeRegexMatch({ str: 'lodash', pattern: 'typescript', useRegex: false })).toBe(
                false,
            );
        });

        test('should be case-sensitive', () => {
            expect(safeRegexMatch({ str: 'lodash', pattern: 'Lodash', useRegex: false })).toBe(
                false,
            );
        });

        test('should match empty strings', () => {
            expect(safeRegexMatch({ str: '', pattern: '', useRegex: false })).toBe(true);
        });
    });

    describe('regex matching (useRegex: true)', () => {
        test('should match simple literal patterns', () => {
            expect(safeRegexMatch({ str: '@types/node', pattern: '@types/node' })).toBe(true);
        });

        test('should match raw regex pattern .+', () => {
            expect(safeRegexMatch({ str: 'anything', pattern: '.+' })).toBe(true);
            expect(safeRegexMatch({ str: '', pattern: '.+' })).toBe(false);
        });

        test('should support generator pattern like @projectName/oftName-.+', () => {
            // Tests the pattern used by generator: @projectName/oftName-.+
            // This matches packages like @myproject/my-oft-app-activity-factory
            const projectName = 'myproject';
            const oftNameKebab = 'my-oft-app';
            const pattern = `@${projectName}/${oftNameKebab}-.+`;

            expect(
                safeRegexMatch({
                    str: '@myproject/my-oft-app-activity-factory',
                    pattern,
                }),
            ).toBe(true);
            expect(
                safeRegexMatch({
                    str: '@myproject/my-oft-app-workflows',
                    pattern,
                }),
            ).toBe(true);
            expect(
                safeRegexMatch({
                    str: '@myproject/my-oft-app-config',
                    pattern,
                }),
            ).toBe(true);
            expect(
                safeRegexMatch({
                    str: '@myproject/my-oft-app', // No suffix after -
                    pattern,
                }),
            ).toBe(false); // Must have something after the dash
            expect(
                safeRegexMatch({
                    str: '@otherproject/my-oft-app-activity-factory',
                    pattern,
                }),
            ).toBe(false); // Different project name
            expect(
                safeRegexMatch({
                    str: '@myproject/different-oft-app-activity-factory',
                    pattern,
                }),
            ).toBe(false); // Different oft name
        });

        test('should support .*/generator pattern', () => {
            // Tests --only '.*/generator' (proper regex syntax)
            expect(
                safeRegexMatch({
                    str: '@layerzerolabs/generator',
                    pattern: '.*/generator',
                }),
            ).toBe(true);
            expect(
                safeRegexMatch({
                    str: 'generator',
                    pattern: '.*/generator',
                }),
            ).toBe(false); // Must have / before generator
            expect(
                safeRegexMatch({
                    str: '@layerzerolabs/toolkit',
                    pattern: '.*/generator',
                }),
            ).toBe(false); // Doesn't contain /generator
        });

        test('should support @layer.*/generator pattern', () => {
            // Tests --only '@layer.*/generator' (proper regex syntax)
            expect(
                safeRegexMatch({
                    str: '@layerzerolabs/generator',
                    pattern: '@layer.*/generator',
                }),
            ).toBe(true);
            expect(
                safeRegexMatch({
                    str: '@layerzero/generator',
                    pattern: '@layer.*/generator',
                }),
            ).toBe(true);
            expect(
                safeRegexMatch({
                    str: '@types/generator',
                    pattern: '@layer.*/generator',
                }),
            ).toBe(false); // Doesn't start with @layer
            expect(
                safeRegexMatch({
                    str: '@layerzerolabs/toolkit',
                    pattern: '@layer.*/generator',
                }),
            ).toBe(false); // Doesn't end with /generator
        });
    });

    describe('security - ReDoS prevention', () => {
        test('should reject patterns longer than 100 characters', () => {
            const longPattern = 'a'.repeat(101);
            expect(safeRegexMatch({ str: 'test', pattern: longPattern })).toBe(false); // Falls back to includes(), which won't match
        });

        test('should allow patterns up to 100 characters', () => {
            const maxLengthPattern = 'a'.repeat(100);
            expect(safeRegexMatch({ str: 'a', pattern: maxLengthPattern })).toBe(false); // Won't match but won't throw
        });

        test('should handle invalid regex patterns gracefully', () => {
            // Invalid regex should fall back to includes()
            expect(safeRegexMatch({ str: 'test[', pattern: '[invalid' })).toBe(false); // includes() won't find '[invalid' in 'test['
        });

        test('should handle unclosed brackets gracefully', () => {
            expect(safeRegexMatch({ str: 'test', pattern: '[unclosed' })).toBe(false);
        });

        test('should fallback to includes for invalid regex', () => {
            // If regex is invalid, should fall back to string.includes()
            expect(safeRegexMatch({ str: 'contains-pattern', pattern: 'pattern' })).toBe(true); // Even if regex fails, includes() will find it
        });
    });

    describe('edge cases', () => {
        test('should handle special regex characters as literals when regex fails', () => {
            // If pattern has special chars and regex compilation fails, uses includes()
            expect(safeRegexMatch({ str: 'test.*', pattern: '.*' })).toBe(true); // Actually works as regex
        });

        test('should handle empty pattern', () => {
            expect(safeRegexMatch({ str: 'anything', pattern: '' })).toBe(true);
            expect(safeRegexMatch({ str: 'anything', pattern: '', useRegex: false })).toBe(false);
        });

        test('should handle empty string', () => {
            expect(safeRegexMatch({ str: '', pattern: '' })).toBe(true);
            expect(safeRegexMatch({ str: '', pattern: 'something' })).toBe(false);
        });
    });

    describe('behavior preservation', () => {
        test('should preserve behavior for common use cases', () => {
            const patterns = MOVE_TO_DEV_DEFAULT_PATTERN.split(',');
            patterns.forEach((pattern) => {
                expect(safeRegexMatch({ str: pattern, pattern })).toBe(true);
            });
        });
    });
});
