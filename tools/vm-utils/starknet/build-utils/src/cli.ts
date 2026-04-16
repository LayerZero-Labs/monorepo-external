#!/usr/bin/env tsx
/**
 * CLI for generating Starknet contract verification artifact at build time
 *
 * Usage: generate-starknet-verification --package <package> [--package <package>...] --path <output-dir>
 *
 * Example: generate-starknet-verification --package oft --package oft_adapter --package oft_mint_burn --path src/generated/verification
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';

import { parse } from '@layerzerolabs/args';
import { generatePackageName, PackageNameCaseOption } from '@layerzerolabs/repo-utils';

import {
    findScarbPackages,
    prepareContractVerificationArtifact,
    type StarknetSourceSnapshot,
} from './starknetSourceCollector';

const ArgsSchema = z.object({
    package: z
        .array(z.string().min(1, 'Package name cannot be empty'))
        .min(1, 'At least one package is required'),
    path: z.string().min(1, 'Output path cannot be empty'),
});

const main = async (): Promise<void> => {
    const args = parse({
        header: 'Generate Starknet Verification Artifact',
        description: 'Generate contract verification artifact for Starknet packages at build time',
        args: {
            package: {
                type: String,
                alias: 'p',
                multiple: true,
                description: 'Scarb package name(s) to generate verification artifact for',
            },
            path: {
                type: String,
                description: 'Output directory for generated verification files',
            },
        },
    });

    const validationResult = ArgsSchema.safeParse(args);
    if (!validationResult.success) {
        console.error('Validation error:');
        for (const issue of validationResult.error.issues) {
            console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
        }
        process.exit(1);
    }

    const { package: requestedPackages, path: outputDir } = validationResult.data;

    const rootDir = process.cwd();
    const availablePackages = await findScarbPackages(rootDir);

    console.log(`Generating verification artifact for packages: ${requestedPackages.join(', ')}`);
    console.log(`Root directory: ${rootDir}`);
    console.log(`Output directory: ${outputDir}`);
    console.log(`Available packages: ${[...availablePackages.keys()].join(', ')}`);

    const absoluteOutputDir = path.resolve(rootDir, outputDir);
    await fs.mkdir(absoluteOutputDir, { recursive: true });

    const processedPackages: string[] = [];

    for (const packageName of requestedPackages) {
        console.log(`\nProcessing package: ${packageName}`);

        const packagePath = availablePackages.get(packageName);
        if (!packagePath) {
            console.error(
                `  ✗ Package "${packageName}" not found. Available: ${[...availablePackages.keys()].join(', ')}`,
            );
            process.exit(1);
        }

        console.log(`  Package path: ${packagePath}`);

        try {
            const snapshot = await prepareContractVerificationArtifact({
                packagePath,
                workspaceRoot: rootDir,
            });

            const outputFileName = generateVerificationFileName(packageName);
            const outputPath = path.join(absoluteOutputDir, outputFileName);

            await fs.writeFile(outputPath, generateTypedExport(snapshot));
            console.log(`  ✓ Generated: ${outputPath}`);
            console.log(`    Sources collected: ${Object.keys(snapshot.sources).length}`);
            console.log(`    Compiler version: ${snapshot.compilerVersion}`);

            processedPackages.push(packageName);
        } catch (error) {
            console.error(`  ✗ Failed to process ${packageName}:`, error);
            process.exit(1);
        }
    }

    const tsBarrelPath = path.join(absoluteOutputDir, 'index.ts');
    const tsBarrelContent = processedPackages
        .map((packageName) => {
            const pkgFileName = generateVerificationFileName(packageName);
            const baseName = pkgFileName.replace(/\.ts$/, '');
            const exportName = `${generatePackageName(packageName.replace(/_/g, '-'), PackageNameCaseOption.CAMEL_CASE)}VerificationArtifact`;
            return `export { default as ${exportName} } from './${baseName}';`;
        })
        .join('\n');

    await fs.writeFile(tsBarrelPath, tsBarrelContent + '\n');
    console.log(`\n✓ Generated TypeScript barrel: ${tsBarrelPath}`);
    console.log('\nVerification info generation complete!');
};

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});

const generateVerificationFileName = (packageName: string): string => {
    return `${packageName}.ts`;
};

const generateTypedExport = (snapshot: StarknetSourceSnapshot): string => {
    return `import type { StarknetSourceSnapshot } from '@layerzerolabs/build-utils-starknet';

const verificationArtifact: StarknetSourceSnapshot = ${JSON.stringify(snapshot, null, 2)};

export default verificationArtifact;
`;
};
