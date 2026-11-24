import { describe, it } from 'vitest';

import {
    isExecutableNotFoundError,
    parseActiveSdkVersion,
    parseOpenapiGeneratorVersion,
} from './local-version';

describe(parseActiveSdkVersion, () => {
    it('returns the version marked active among several', ({ expect }) => {
        expect(parseActiveSdkVersion('   3.4.8  \n   3.4.9  \n * 3.4.11 \n')).toBe('3.4.11');
    });

    it('returns the active version when it is listed first', ({ expect }) => {
        expect(parseActiveSdkVersion(' * 3.4.8 \n   3.4.11 \n')).toBe('3.4.8');
    });

    it('returns the single installed version even without a marker', ({ expect }) => {
        expect(parseActiveSdkVersion('   3.4.8  \n')).toBe('3.4.8');
    });

    it('returns undefined when several versions are listed without an active marker', ({
        expect,
    }) => {
        expect(parseActiveSdkVersion('   3.4.8  \n   3.4.9  \n')).toBeUndefined();
    });

    it('returns undefined for empty output', ({ expect }) => {
        expect(parseActiveSdkVersion('')).toBeUndefined();
    });
});

describe(parseOpenapiGeneratorVersion, () => {
    it('extracts the version from a single-line output', ({ expect }) => {
        expect(parseOpenapiGeneratorVersion('7.21.0\n')).toBe('7.21.0');
    });

    it('extracts the version when surrounded by other text', ({ expect }) => {
        expect(parseOpenapiGeneratorVersion('openapi-generator-cli 7.21.0 (sha abc)\n')).toBe(
            '7.21.0',
        );
    });

    it('returns undefined when no version is present', ({ expect }) => {
        expect(parseOpenapiGeneratorVersion('unknown')).toBeUndefined();
    });
});

describe(isExecutableNotFoundError, () => {
    it('recognizes a spawn error for a missing executable', ({ expect }) => {
        expect(
            isExecutableNotFoundError(Object.assign(new Error('spawn dpm'), { code: 'ENOENT' })),
        ).toBe(true);
    });

    it('does not treat a non-zero exit as a missing executable', ({ expect }) => {
        expect(isExecutableNotFoundError(Object.assign(new Error('exited'), { code: 1 }))).toBe(
            false,
        );
    });

    it('does not treat a permission error as a missing executable', ({ expect }) => {
        expect(
            isExecutableNotFoundError(Object.assign(new Error('denied'), { code: 'EACCES' })),
        ).toBe(false);
    });

    it('does not treat a non-error value as a missing executable', ({ expect }) => {
        expect(isExecutableNotFoundError('boom')).toBe(false);
    });
});
