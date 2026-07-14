import { createHash } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { PathInclusionPredicate, ZipEntryInfo } from '@layerzerolabs/deterministic-zip';
import { zipDirectoryToUint8Array, ZipEntryType } from '@layerzerolabs/deterministic-zip';
import type { ToolCommandExecutionOptions } from '@layerzerolabs/vm-tooling';

/**
 * Our own output directory. The predicate always prunes it, so it is the one place inside the
 * source tree the archive may be written to without contaminating itself (see `packageSource`).
 */
const ARTIFACTS_DIR = '.artifacts';

/**
 * Directories the zip walker never descends into: build output, dependency installs, VCS, local
 * tool caches/credentials, and our own output. Returning `false` for these directory entries
 * prunes the subtree in DeterministicZip (so nested symlinks under `node_modules` are never
 * visited). The actual content filter is the include-only allow-list below.
 */
const NON_SOURCE_DIRS = new Set<string>([
    // build / cache output
    'target',
    'docker-target',
    'dist',
    '.turbo',
    // dependency installs — the self-contained copy lives in dependencies/
    'node_modules',
    // vcs / ci
    '.git',
    '.github',
    // local tool config / caches / credentials
    '.cargo',
    '.soroban',
    '.stellar',
    '.aws',
    '.claude',
    // stellar test artifacts
    'test_snapshots',
    // our own output directory
    ARTIFACTS_DIR,
]);

/**
 * Default-deny allow-list: crate-relative globs for files a reproducible Rust/Soroban build needs.
 * Prefixed with `rootDirName/` at match time (same as `--include`). A file is packaged only if it
 * matches one of these (or a user `--include`). Everything else is dropped, so a stray or
 * misspelled secret file (`.env`, `*.key`, `credentials.json`, …) can never leak. Opt other
 * build-time assets in with `--include`.
 *
 * Patterns cover Rust sources, lockfiles, Cargo manifests anywhere under the crate,
 * `rust-toolchain.toml` / `rustfmt.toml` / `clippy.toml` at the crate root only (not nested
 * copies).
 */
const DEFAULT_INCLUDE_GLOBS = [
    '**/*.rs',
    '**/*.lock',
    '**/Cargo.toml',
    'rust-toolchain.toml',
    'rustfmt.toml',
    'clippy.toml',
] as const;

/** Manifest + lockfile required at the crate root for a reproducible Cargo/Soroban package. */
const REQUIRED_ROOT_FILES = ['Cargo.toml', 'Cargo.lock'] as const;

export interface SourcePredicateOptions {
    /**
     * Top-level archive folder name — the basename of the crate directory (e.g. `stellar`).
     * Every kept entry must be this folder or live under it.
     */
    rootDirName: string;
    /**
     * Native Node glob patterns, relative to the crate root, for build assets the defaults miss
     * (e.g. `config/app.json`, `assets/**`). Use '/' as the separator.
     */
    include?: string[];
    /**
     * Native Node glob patterns, relative to the crate root, to drop even when they match the
     * default allow-list or `--include`. Always wins over include. Same matching as `--include`
     * (`path.posix.matchesGlob`); e.g. `tests/**` excludes files under `tests/`.
     */
    exclude?: string[];
}

/**
 * Include-only predicate for zipping the crate's parent directory.
 *
 * Keeps only paths under `rootDirName/`, prunes `NON_SOURCE_DIRS`, applies optional `--exclude`
 * (always wins), and for files applies the default-deny allow-list (plus optional `--include`
 * patterns prefixed with `rootDirName/`). Symlinks are not handled here — DeterministicZip throws
 * if it encounters one outside a pruned directory.
 */
export const makeSourcePredicate = ({
    rootDirName,
    include = [],
    exclude = [],
}: SourcePredicateOptions): PathInclusionPredicate => {
    const rootPrefix = `${rootDirName}/`;
    const defaultIncludePatterns = DEFAULT_INCLUDE_GLOBS.map(
        (pattern) => `${rootDirName}/${pattern}`,
    );
    const includePatterns = include.map((pattern) => `${rootDirName}/${pattern}`);
    const excludePatterns = exclude.map((pattern) => `${rootDirName}/${pattern}`);

    return ({ relPath, type }: ZipEntryInfo): boolean => {
        if (relPath !== rootDirName && !relPath.startsWith(rootPrefix)) {
            return false;
        }

        if (excludePatterns.some((pattern) => path.posix.matchesGlob(relPath, pattern))) {
            return false;
        }

        if (type === ZipEntryType.Directory) {
            if (NON_SOURCE_DIRS.has(path.posix.basename(relPath))) return false;
            return true;
        }

        return (
            defaultIncludePatterns.some((pattern) => path.posix.matchesGlob(relPath, pattern)) ||
            includePatterns.some((pattern) => path.posix.matchesGlob(relPath, pattern))
        );
    };
};

export interface PackageSourceOptions {
    /** Output .zip path; default <cwd>/.artifacts/<basename>-source.zip. */
    output?: string;
    /** Native Node glob patterns for entries to include beyond the default source extensions. */
    include?: string[];
    /** Native Node glob patterns to drop; always wins over the allow-list and `--include`. */
    exclude?: string[];
}

/**
 * Package the self-contained crate in `cwd` into a byte-deterministic source .zip and print its
 * SHA-256 (for `--meta source_sha256=…`).
 *
 * Zips the parent of `cwd` via DeterministicZip with a predicate that keeps only paths under the
 * crate basename (e.g. `stellar/…`), so the archive extracts into exactly one top-level folder
 * named after the crate. Filtering is include-only: only `.rs`, `.lock`, `Cargo.toml`, root
 * `rust-toolchain.toml` / `rustfmt.toml` / `clippy.toml`, and anything named by `--include` are
 * packaged; `--exclude` always wins over that allow-list. Non-source directories (`node_modules`,
 * `target`, …) are pruned by the predicate. Symlinks outside those pruned dirs cause
 * DeterministicZip to throw.
 *
 * The archive is written under `.artifacts/` by default; a custom `--output` must be outside the
 * source tree or under `.artifacts/`, else it is rejected. `Cargo.toml` and `Cargo.lock` must
 * exist at the crate root.
 */
export const packageSource = async (
    { output, include = [], exclude = [] }: PackageSourceOptions,
    { cwd }: Pick<ToolCommandExecutionOptions, 'cwd'>,
): Promise<void> => {
    const sourceDir = path.resolve(cwd);
    const rootDirName = path.basename(sourceDir);
    const parentDir = path.dirname(sourceDir);
    const outputPath = output
        ? path.resolve(sourceDir, output)
        : path.join(sourceDir, ARTIFACTS_DIR, `${rootDirName}-source.zip`);

    for (const name of REQUIRED_ROOT_FILES) {
        try {
            await access(path.join(sourceDir, name));
        } catch {
            throw new Error(
                `${name} must exist at the crate root to package a reproducible source archive ` +
                    `(looked for ${path.join(sourceDir, name)})`,
            );
        }
    }

    // The archive is built by walking parentDir; the only safe in-tree output location is the
    // always-pruned .artifacts/ dir. Reject any other output inside sourceDir.
    const relOutput = path.relative(sourceDir, outputPath);
    const isOutputInsideSource =
        relOutput !== '' && !relOutput.startsWith('..') && !path.isAbsolute(relOutput);
    const relOutputPosix = relOutput.split(path.sep).join('/');
    // Must be a path *under* .artifacts/ (e.g. .artifacts/foo.zip). Exact `.artifacts` would
    // resolve to a file named `.artifacts` in the crate root and break later default writes.
    const isUnderArtifacts = relOutputPosix.startsWith(`${ARTIFACTS_DIR}/`);
    if (isOutputInsideSource && !isUnderArtifacts) {
        throw new Error(
            `--output must be under ${ARTIFACTS_DIR}/ or outside the source directory, got ` +
                `"${relOutputPosix}". Any other location inside ${sourceDir} would be captured in ` +
                `the archive and break reproducibility.`,
        );
    }

    // Count included files so an all-non-source tree throws instead of writing a fileless archive.
    let includedFileCount = 0;
    const predicate = makeSourcePredicate({ rootDirName, include, exclude });
    const countingPredicate: PathInclusionPredicate = (entry) => {
        const keep = predicate(entry);
        if (keep && entry.type === ZipEntryType.File) includedFileCount += 1;
        return keep;
    };

    let bytes: Uint8Array;
    try {
        bytes = await zipDirectoryToUint8Array(parentDir, {
            pathInclusionPredicate: countingPredicate,
        });
    } catch (cause) {
        throw new Error(`Failed to package source: ${sourceDir}`, { cause });
    }

    if (includedFileCount === 0) {
        throw new Error(`Failed to package source: no source files matched under ${sourceDir}`);
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, bytes);

    const digest = createHash('sha256').update(bytes).digest('hex');
    console.info(`✅ Reproducible source archive: ${outputPath}`);
    console.info(`   source_sha256=${digest}`);
};
