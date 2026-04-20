#!/usr/bin/env tsx

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const configIdx = args.indexOf('--config');

if (configIdx === -1 || !args[configIdx + 1]) {
    console.error('Usage: stellar-ts-bindings-gen --config <path>');
    process.exit(1);
}

const configPath = args[configIdx + 1];

// Compute relative path from CWD to this package's Cargo.toml
const cargoManifest = path.relative(process.cwd(), path.resolve(__dirname, '..', 'Cargo.toml'));

const script = `cargo run --manifest-path ${cargoManifest} -- --config ${configPath}`;

try {
    const lzTool = path.resolve(__dirname, '..', 'node_modules', '.bin', 'lz-tool');
    execSync(`${lzTool} --script "${script}" stellar`, { stdio: 'inherit' });
} catch (e) {
    process.exit((e as { status?: number }).status || 1);
}
