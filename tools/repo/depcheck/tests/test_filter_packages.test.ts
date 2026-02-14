import { describe, expect, test } from 'vitest';

import { filterPackages } from '../src/deps';

describe('filterPackages', () => {
    const samplePackages = [
        '@layerzerolabs/toolkit',
        '@layerzerolabs/generator',
        '@layerzerolabs/worker',
        '@types/node',
        'lodash',
        'typescript',
        '@types/lodash',
    ];

    describe('no filtering', () => {
        test('should return all packages when no filters provided', () => {
            const result = filterPackages({ packages: samplePackages });
            expect(result).toEqual(samplePackages);
        });

        test('should return all packages when only and ignore are undefined', () => {
            const result = filterPackages({
                packages: samplePackages,
                only: undefined,
                ignore: undefined,
            });
            expect(result).toEqual(samplePackages);
        });

        test('should handle empty array', () => {
            const result = filterPackages({ packages: [] });
            expect(result).toEqual([]);
        });
    });

    describe('only filter - exact matching (regex: false)', () => {
        test('should filter to single exact match', () => {
            const result = filterPackages({
                packages: samplePackages,
                only: '@layerzerolabs/toolkit',
                regex: false,
            });
            expect(result).toEqual(['@layerzerolabs/toolkit']);
        });

        test('should return empty array when no exact match', () => {
            const result = filterPackages({
                packages: samplePackages,
                only: 'nonexistent-package',
                regex: false,
            });
            expect(result).toEqual([]);
        });

        test('should filter to multiple comma-separated exact matches', () => {
            const result = filterPackages({
                packages: samplePackages,
                only: '@layerzerolabs/toolkit,@layerzerolabs/generator',
                regex: false,
            });
            expect(result).toEqual(['@layerzerolabs/toolkit', '@layerzerolabs/generator']);
        });

        test('should trim whitespace in comma-separated values', () => {
            const result = filterPackages({
                packages: samplePackages,
                only: ' @layerzerolabs/toolkit , @layerzerolabs/generator ',
                regex: false,
            });
            expect(result).toEqual(['@layerzerolabs/toolkit', '@layerzerolabs/generator']);
        });

        test('should handle partial matches with exact matching (should not match)', () => {
            const result = filterPackages({
                packages: samplePackages,
                only: 'lodash',
                regex: false,
            });
            // Should match 'lodash' exactly, not '@types/lodash'
            expect(result).toEqual(['lodash']);
            expect(result).not.toContain('@types/lodash');
        });

        test('should be case-sensitive', () => {
            const result = filterPackages({
                packages: samplePackages,
                only: 'LODASH',
                regex: false,
            });
            expect(result).toEqual([]);
        });
    });

    describe('only filter - regex matching (regex: true)', () => {
        test('should filter using regex pattern', () => {
            const result = filterPackages({
                packages: samplePackages,
                only: '@layerzerolabs/.*',
                regex: true,
            });
            expect(result).toEqual([
                '@layerzerolabs/toolkit',
                '@layerzerolabs/generator',
                '@layerzerolabs/worker',
            ]);
        });

        test('should filter using regex pattern', () => {
            const result = filterPackages({
                packages: samplePackages,
                only: '.*/generator',
                regex: true,
            });
            expect(result).toEqual(['@layerzerolabs/generator']);
        });

        test('should filter multiple regex patterns', () => {
            const result = filterPackages({
                packages: samplePackages,
                only: '@types/.*,lodash',
                regex: true,
            });
            expect(result).toEqual(['@types/node', 'lodash', '@types/lodash']);
        });

        test('should trim whitespace in comma-separated regex patterns', () => {
            const result = filterPackages({
                packages: samplePackages,
                only: ' @layerzerolabs/.* , typescript ',
                regex: true,
            });
            expect(result).toEqual([
                '@layerzerolabs/toolkit',
                '@layerzerolabs/generator',
                '@layerzerolabs/worker',
                'typescript',
            ]);
        });

        test('should handle empty pattern', () => {
            const result = filterPackages({
                packages: samplePackages,
                only: '',
                regex: true,
            });
            // Empty pattern should match everything (based on safeRegexMatch behavior)
            expect(result).toEqual(samplePackages);
        });
    });

    describe('ignore filter - exact matching (regex: false)', () => {
        test('should exclude single exact match', () => {
            const result = filterPackages({
                packages: samplePackages,
                ignore: '@layerzerolabs/toolkit',
                regex: false,
            });
            expect(result).not.toContain('@layerzerolabs/toolkit');
            expect(result.length).toBe(samplePackages.length - 1);
        });

        test('should exclude multiple comma-separated exact matches', () => {
            const result = filterPackages({
                packages: samplePackages,
                ignore: '@layerzerolabs/toolkit,@layerzerolabs/generator',
                regex: false,
            });
            expect(result).not.toContain('@layerzerolabs/toolkit');
            expect(result).not.toContain('@layerzerolabs/generator');
            expect(result.length).toBe(samplePackages.length - 2);
        });

        test('should trim whitespace in comma-separated ignore values', () => {
            const result = filterPackages({
                packages: samplePackages,
                ignore: ' lodash , typescript ',
                regex: false,
            });
            expect(result).not.toContain('lodash');
            expect(result).not.toContain('typescript');
        });

        test('should not exclude partial matches with exact matching', () => {
            const result = filterPackages({
                packages: samplePackages,
                ignore: 'lodash',
                regex: false,
            });
            // Should exclude 'lodash' exactly, but keep '@types/lodash'
            expect(result).not.toContain('lodash');
            expect(result).toContain('@types/lodash');
        });

        test('should return all packages when ignoring non-existent package', () => {
            const result = filterPackages({
                packages: samplePackages,
                ignore: 'nonexistent-package',
                regex: false,
            });
            expect(result).toEqual(samplePackages);
        });
    });

    describe('ignore filter - regex matching (regex: true)', () => {
        test('should exclude packages matching regex pattern', () => {
            const result = filterPackages({
                packages: samplePackages,
                ignore: '@layerzerolabs/.*',
                regex: true,
            });
            expect(result).not.toContain('@layerzerolabs/toolkit');
            expect(result).not.toContain('@layerzerolabs/generator');
            expect(result).not.toContain('@layerzerolabs/worker');
            expect(result).toEqual(['@types/node', 'lodash', 'typescript', '@types/lodash']);
        });

        test('should exclude packages matching wildcard pattern', () => {
            const result = filterPackages({
                packages: samplePackages,
                ignore: '@types/.*',
                regex: true,
            });
            expect(result).not.toContain('@types/node');
            expect(result).not.toContain('@types/lodash');
        });

        test('should exclude multiple regex patterns', () => {
            const result = filterPackages({
                packages: samplePackages,
                ignore: '@layerzerolabs/.*,@types/.*',
                regex: true,
            });
            expect(result).toEqual(['lodash', 'typescript']);
        });

        test('should trim whitespace in comma-separated ignore patterns', () => {
            const result = filterPackages({
                packages: samplePackages,
                ignore: ' @layerzerolabs/.* , lodash ',
                regex: true,
            });
            expect(result).not.toContain('@layerzerolabs/toolkit');
            expect(result).not.toContain('lodash');
        });
    });

    describe('combined only and ignore filters', () => {
        test('should apply only filter first, then ignore filter', () => {
            const result = filterPackages({
                packages: samplePackages,
                only: '@layerzerolabs/.*',
                ignore: '@layerzerolabs/generator',
                regex: true,
            });
            // First filter to @layerzerolabs/.*, then exclude generator
            expect(result).toEqual(['@layerzerolabs/toolkit', '@layerzerolabs/worker']);
        });

        test('should work with exact matching for both', () => {
            const result = filterPackages({
                packages: samplePackages,
                only: '@layerzerolabs/toolkit,@layerzerolabs/generator,@layerzerolabs/worker',
                ignore: '@layerzerolabs/generator',
                regex: false,
            });
            expect(result).toEqual(['@layerzerolabs/toolkit', '@layerzerolabs/worker']);
        });

        test('should work with regex matching for both', () => {
            const result = filterPackages({
                packages: samplePackages,
                only: '@layerzerolabs/.*',
                ignore: '@layerzerolabs/generator',
                regex: true,
            });
            // regex applies to both only and ignore filters
            expect(result).toEqual(['@layerzerolabs/toolkit', '@layerzerolabs/worker']);
        });

        test('should return empty array when ignore excludes all only matches', () => {
            const result = filterPackages({
                packages: samplePackages,
                only: '@layerzerolabs/toolkit',
                ignore: '@layerzerolabs/toolkit',
                regex: false,
            });
            expect(result).toEqual([]);
        });
    });

    describe('edge cases', () => {
        test('should handle empty only filter', () => {
            const result = filterPackages({
                packages: samplePackages,
                only: '',
                regex: false,
            });
            // Empty string is falsy, so no filtering occurs (returns all packages)
            expect(result).toEqual(samplePackages);
        });

        test('should handle empty ignore filter', () => {
            const result = filterPackages({
                packages: samplePackages,
                ignore: '',
                regex: false,
            });
            // Empty ignore should not exclude anything
            expect(result).toEqual(samplePackages);
        });

        test('should handle regex default value (false)', () => {
            const result1 = filterPackages({
                packages: samplePackages,
                only: 'lodash',
            });
            // Should use exact matching (regex defaults to false)
            expect(result1).toEqual(['lodash']);
        });

        test('should handle regex explicitly set to false', () => {
            const result = filterPackages({
                packages: samplePackages,
                only: 'lodash',
                regex: false,
            });
            expect(result).toEqual(['lodash']);
        });

        test('should handle single package array', () => {
            const result = filterPackages({
                packages: ['@layerzerolabs/toolkit'],
                only: '@layerzerolabs/toolkit',
                regex: false,
            });
            expect(result).toEqual(['@layerzerolabs/toolkit']);
        });

        test('should handle packages with special characters', () => {
            const specialPackages = ['@scope/package-name', 'package@1.0.0', 'package-name_v2'];
            const result = filterPackages({
                packages: specialPackages,
                only: '@scope/package-name',
                regex: false,
            });
            expect(result).toEqual(['@scope/package-name']);
        });

        test('should handle very long comma-separated list', () => {
            const manyPackages = Array.from({ length: 100 }, (_, i) => `package-${i}`);
            const result = filterPackages({
                packages: manyPackages,
                only: 'package-0,package-50,package-99',
                regex: false,
            });
            expect(result).toEqual(['package-0', 'package-50', 'package-99']);
        });
    });

    describe('real-world scenarios', () => {
        test('should filter layerzero packages only', () => {
            const result = filterPackages({
                packages: samplePackages,
                only: '@layerzerolabs/.*',
                regex: true,
            });
            expect(result.every((p) => p.startsWith('@layerzerolabs/'))).toBe(true);
        });

        test('should exclude all types packages', () => {
            const result = filterPackages({
                packages: samplePackages,
                ignore: '@types/.*',
                regex: true,
            });
            expect(result.every((p) => !p.startsWith('@types/'))).toBe(true);
        });

        test('should filter generators only but exclude specific one', () => {
            const packages = [
                '@layerzerolabs/generator',
                '@layerzerolabs/toolkit-generator',
                '@other/generator',
            ];
            const result = filterPackages({
                packages,
                only: '.*generator',
                ignore: '@layerzerolabs/generator',
                regex: true,
            });
            expect(result).toEqual(['@layerzerolabs/toolkit-generator', '@other/generator']);
        });
    });
});
