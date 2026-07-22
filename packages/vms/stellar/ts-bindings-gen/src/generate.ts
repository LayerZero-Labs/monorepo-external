#!/usr/bin/env tsx

import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_RUST_TOOLCHAIN = '1.90.0';

const args = process.argv.slice(2);
const exitWithUsage = (): never => {
    console.error('Usage: stellar-ts-bindings-gen --config <path> [--rust-toolchain <version>]');
    process.exit(1);
};

const parseOptionValue = (option: string): string | undefined => {
    const optionIdx = args.indexOf(option);
    if (optionIdx === -1) {
        return undefined;
    }

    const value = args[optionIdx + 1];
    if (!value || value.startsWith('--')) {
        exitWithUsage();
    }

    return value;
};

const configPath = parseOptionValue('--config');
if (!configPath) {
    exitWithUsage();
}

const requestedRustToolchain = parseOptionValue('--rust-toolchain');
const rustToolchain = requestedRustToolchain ?? DEFAULT_RUST_TOOLCHAIN;

// Compute relative path from CWD to this package's Cargo.toml
const cargoManifest = path.relative(process.cwd(), path.resolve(__dirname, '..', 'Cargo.toml'));

const script = `cargo run --manifest-path ${cargoManifest} -- --config ${configPath}`;

try {
    const lzTool = path.resolve(__dirname, '..', 'node_modules', '.bin', 'lz-tool');
    execFileSync(
        lzTool,
        ['--env', `RUSTUP_TOOLCHAIN=${rustToolchain}`, '--script', script, 'stellar'],
        { stdio: 'inherit' },
    );
} catch (e) {
    process.exit((e as { status?: number }).status || 1);
}
