/** Files vendored into dependencies/ — everything else is skipped by type. */
export const COPY_EXTENSIONS = new Set(['.rs', '.toml', '.json']);

/** Directories never descended into when copying or scanning. */
const EXCLUDE_DIR = new Set([
    // npm directories
    'dependencies',
    'node_modules',
    'target',
    '.turbo',
    // cargo directories
    'examples',
    'benches',
    'fuzz',
    '.cargo',
    // vcs / ci
    '.git',
    '.github',
    // shared directories
    'tests',
    'integration-tests',
    'integration_tests',
    // stellar test snapshots
    'test_snapshots',
]);

/** Files matching COPY_EXTENSIONS that must still be skipped — lockfiles, toolchain config, etc. */
const EXCLUDE_FILE = new Set([
    // npm
    'package.json',
    'pnpm-lock.yaml',
    // turbo
    'turbo-snapshot.lock.json',
    'turbo.json',
    // cargo/rust
    'Cargo.lock',
    'clippy.toml',
    'deny.toml',
    'rust-toolchain.toml',
    'rustfmt.toml',
    // solana
    'Anchor.toml',
]);

const COPY_EXCLUDES = new Set([...EXCLUDE_DIR, ...EXCLUDE_FILE]);

/** Filter excluded names from a directory listing. */
export const removeExcludedFiles = (entries: string[]): string[] =>
    entries.filter((entry) => !COPY_EXCLUDES.has(entry));

/**
 * True if a resolved crate path contains an excluded segment.
 * Do not use on raw `path` dep values — those legitimately pass through node_modules.
 */
export const hasExcludedSegment = (relPath: string): boolean =>
    relPath.split(/[\\/]+/).some((segment) => EXCLUDE_DIR.has(segment));
