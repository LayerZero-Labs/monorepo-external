import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';

import type { PackageJson } from '../types';
import { getPnpmLs } from '../utils';

interface MismatchedRef {
    file: string;
    package: string;
    currentRef: string;
}

const findMismatchesInDeps = (
    deps: Record<string, string> | undefined,
    workspacePackages: Set<string>,
    file: string,
): MismatchedRef[] => {
    if (!deps) return [];

    const mismatches: MismatchedRef[] = [];

    for (const [depName, refValue] of Object.entries(deps)) {
        if (
            depName.startsWith('@layerzerolabs/') &&
            refValue.startsWith('catalog:') &&
            workspacePackages.has(depName)
        ) {
            mismatches.push({ file, package: depName, currentRef: refValue });
        }
    }

    return mismatches;
};

const prioritizeWorkspaceDeps = async () => {
    const { pnpmLs } = await getPnpmLs();

    const workspacePackages = new Set(
        pnpmLs.map((p) => p.name).filter((name) => name.startsWith('@layerzerolabs/')),
    );

    console.log(`Found ${workspacePackages.size} @layerzerolabs workspace packages\n`);

    const mismatches: MismatchedRef[] = [];

    for (const pkg of pnpmLs) {
        if (pkg.name === 'root') continue;

        const packageJsonPath = path.join(pkg.path, 'package.json');
        const content = await fs.readFile(packageJsonPath, 'utf-8');
        const packageJson: PackageJson = JSON.parse(content);
        const file = path.relative(process.cwd(), packageJsonPath);

        mismatches.push(
            ...findMismatchesInDeps(packageJson.dependencies, workspacePackages, file),
            ...findMismatchesInDeps(packageJson.devDependencies, workspacePackages, file),
            ...findMismatchesInDeps(packageJson.implicitDependencies, workspacePackages, file),
        );
    }

    if (mismatches.length === 0) {
        console.log('✅ No mismatched references found!');
        process.exit(0);
    }

    console.log(`❌ Found ${mismatches.length} mismatched references:\n`);

    // Group by package
    const byPackage = new Map<string, MismatchedRef[]>();
    for (const mismatch of mismatches) {
        const existing = byPackage.get(mismatch.package) || [];
        existing.push(mismatch);
        byPackage.set(mismatch.package, existing);
    }

    for (const [pkg, refs] of Array.from(byPackage.entries())) {
        console.log(`\n📦 ${pkg} (should be "workspace:*"):`);
        for (const ref of refs) {
            console.log(`   - ${ref.file}`);
            console.log(`     current: "${ref.currentRef}"`);
        }
    }

    console.log('\n---');
    console.log(`Total: ${mismatches.length} references in ${byPackage.size} packages need fixing`);
    console.log('\nTo fix: change catalog: references to workspace:* for these packages');

    process.exit(1);
};

export const prioritizeWorkspaceDepsCmd = new Command('prioritize-workspace-deps')
    .description('Check for @layerzerolabs packages using catalog: that should use workspace:*')
    .action(prioritizeWorkspaceDeps);
