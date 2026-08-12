#!/usr/bin/env tsx
/**
 * CLI for generating Starknet contract verification artifact at build time
 *
 * Usage: generate-starknet-verification --scarb-package <package> --path <output-dir>
 *
 * Example: generate-starknet-verification --scarb-package oft_adapter --path src/generated/verification
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
    'scarb-package': z.string().min(1, 'Scarb package name cannot be empty'),
    path: z.string().min(1, 'Output path cannot be empty'),
});

type VerificationCliArgs = z.infer<typeof ArgsSchema>;

const main = async (): Promise<void> => {
    const args = parse<VerificationCliArgs>({
        header: 'Generate Starknet Verification Artifact',
        description: 'Generate contract verification artifact for Starknet packages at build time',
        args: {
            'scarb-package': {
                type: String,
                description: 'Scarb package name to generate verification artifact for',
            },
            path: {
                type: String,
                description: 'Output directory for generated verification files',
            },
        },
    });

    const validationResult = ArgsSchema.safeParse(args);
    if (!validationResult.success) {
        throw new Error(`Invalid arguments:\n${z.prettifyError(validationResult.error)}`);
    }

    const { 'scarb-package': scarbPackage, path: outputDir } = validationResult.data;

    const scarbWorkspaceRoot = process.cwd();
    const availablePackages = await findScarbPackages(scarbWorkspaceRoot);
    const packagePath = availablePackages.get(scarbPackage);

    if (!packagePath) {
        throw new Error(
            `Scarb package "${scarbPackage}" not found in ${scarbWorkspaceRoot}. ` +
                `Available: ${[...availablePackages.keys()].join(', ')}`,
        );
    }

    console.log(`Generating verification artifact for Scarb package: ${scarbPackage}`);
    console.log(`Scarb workspace root: ${scarbWorkspaceRoot}`);
    console.log(`Package path: ${packagePath}`);
    console.log(`Output directory: ${outputDir}`);

    const absoluteOutputDir = path.resolve(scarbWorkspaceRoot, outputDir);
    await fs.mkdir(absoluteOutputDir, { recursive: true });

    const outputPath = path.join(absoluteOutputDir, `${scarbPackage}.ts`);

    try {
        const snapshot = await prepareContractVerificationArtifact({
            packagePath,
            workspaceRoot: scarbWorkspaceRoot,
        });

        await fs.writeFile(outputPath, generateTypedExport(snapshot));
        console.log(`\n✓ Generated: ${outputPath}`);
        console.log(`  Sources collected: ${Object.keys(snapshot.sources).length}`);
        console.log(`  Compiler version: ${snapshot.compilerVersion}`);
    } catch (cause) {
        throw new Error(`Failed to process Scarb package "${scarbPackage}"`, { cause });
    }

    const exportName = `${generatePackageName(scarbPackage.replace(/_/g, '-'), PackageNameCaseOption.CAMEL)}VerificationArtifact`;
    const tsBarrelPath = path.join(absoluteOutputDir, 'index.ts');

    await fs.writeFile(
        tsBarrelPath,
        `export { default as ${exportName} } from './${scarbPackage}';\n`,
    );
    console.log(`\n✓ Generated TypeScript barrel: ${tsBarrelPath}`);
    console.log('\nVerification info generation complete!');
};

const generateTypedExport = (snapshot: StarknetSourceSnapshot): string => {
    return `import type { StarknetSourceSnapshot } from '@layerzerolabs/build-utils-starknet';

const verificationArtifact: StarknetSourceSnapshot = ${JSON.stringify(snapshot, null, 2)};

export default verificationArtifact;
`;
};

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
