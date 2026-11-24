import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { promisify } from 'util';

import { generateWagmiBarrelExport } from './barrel-export';

const execFileAsync = promisify(execFile);

interface GenerateOptions {
    configs: string[];
    cwd?: string;
    clean?: boolean;
    noBarrel?: boolean;
}

/**
 * Run wagmi generate for a single config file.
 * Uses async execution to avoid blocking, but maintains sequential order via await.
 */
async function runWagmiGenerate(configPath: string, cwd: string): Promise<void> {
    console.log(`   🔨 ${configPath}`);
    try {
        await execFileAsync('pnpm', ['exec', 'wagmi', 'generate', '--config', configPath], {
            cwd,
            encoding: 'utf-8',
        });
    } catch (error) {
        throw new Error(`Failed to run wagmi generate for ${configPath}: ${error}`);
    }
}

/**
 * Find the `generated-abi` directory under `src/`, if it exists.
 */
async function findGeneratedAbiDirectory(cwd: string): Promise<string | undefined> {
    const candidate = path.resolve(cwd, 'src', 'generated-abi');
    try {
        const stat = await fs.stat(candidate);
        if (stat.isDirectory()) {
            return './src/generated-abi';
        }
    } catch {
        // Directory doesn't exist
    }
    return undefined;
}

/**
 * Clean the `generated-abi` output directory.
 */
async function cleanOutputDirectory(cwd: string): Promise<void> {
    console.log(`🧹 Cleaning output directory...`);
    const fullPath = path.resolve(cwd, 'src', 'generated-abi');
    try {
        await fs.rm(fullPath, { recursive: true, force: true });
        console.log(`   ✓ Cleaned ./src/generated-abi`);
    } catch {
        // Directory doesn't exist, ignore
    }
}

/**
 * Main function that runs wagmi generate and barrel exports.
 *
 * @param options - Options for wagmi generation.
 * @param options.configs - One or more wagmi config file paths.
 * @param options.cwd - Working directory (defaults to process.cwd()).
 * @param options.clean - Whether to clean output directory before generating.
 * @param options.noBarrel - Whether to skip barrel export generation (only run wagmi generate).
 */
export async function generateWagmiWithBarrel(options: GenerateOptions): Promise<void> {
    const cwd = options.cwd || process.cwd();

    // Step 1: Clean output directory if requested
    if (options.clean !== false) {
        await cleanOutputDirectory(cwd);
    }

    // Step 2: Run wagmi generate for ALL configs (must complete before barrel exports)
    console.log(
        `🔨 Running wagmi generate for ${options.configs.length} config${options.configs.length === 1 ? '' : 's'}...`,
    );

    for (const configPath of options.configs) {
        await runWagmiGenerate(configPath, cwd);
    }

    console.log(`   ✓ All wagmi generation complete`);

    // If --noBarrel is set, skip barrel export generation
    if (options.noBarrel) {
        console.log(`✅ Successfully generated wagmi types (barrel exports skipped)`);
        return;
    }

    // Step 3: Discover generated-abi directory
    console.log(`🔍 Discovering generated-abi directory...`);
    const generatedDir = await findGeneratedAbiDirectory(cwd);

    if (!generatedDir) {
        throw new Error('No generated-abi directory found in ./src after wagmi generation');
    }

    console.log(`   Found: ${generatedDir}`);

    // Step 4: Generate barrel exports (only after ALL wagmi generates are done)
    console.log(`📦 Generating barrel exports...`);
    const fullPath = path.resolve(cwd, generatedDir);

    try {
        await generateWagmiBarrelExport(fullPath);
    } catch (error) {
        console.error(`❌ Failed to generate barrel export for ${generatedDir}:`, error);
        throw error;
    }

    console.log(`✅ Successfully generated ABI package!`);
}
