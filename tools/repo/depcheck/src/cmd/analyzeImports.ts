import { Command } from 'commander';

import { extractPackageImports } from '../ast';
import { updateDeps } from '../deps';
import { buildGraph } from '../graph';
import type { PackageJson } from '../types';
import { getPnpmLs } from '../utils';

export const analyzeImportsCmd = new Command('analyze-imports')
    .description('Analyze which symbols are imported from a package')
    .option('--update-deps', 'update dependencies')
    .option('--only <name>', 'Check only this workspace package (by exact name or regex pattern).')
    .option('--ignore <ignore>', 'ignore packages')
    .option('--no-regex', 'Not use regex for pattern matching (applied on only, toDev, ignore).')
    .option(
        '--ignore-patterns <patterns...>',
        'space-separated glob patterns to ignore in depcheck (e.g., docker/evm/script_that_runs_within_contrainer.ts)',
    )
    .argument('<package>', 'package name')
    .action(async (packageName, options) => {
        const { pnpmLs, pnpmLsObject } = await getPnpmLs();
        const packages: string[] = pnpmLs.map((p) => p.name).filter((x) => x !== 'root');
        let packageResult: { [key: string]: PackageJson } = {};
        if (options.updateDeps) {
            packageResult = await updateDeps({
                packages,
                pnpmLsObject,
                only: options.only,
                ignore: options.ignore,
                regex: options.regex,
                ignorePatterns: options.ignorePatterns,
            });
        }
        const graph = await buildGraph(packages, packageResult, pnpmLsObject);
        const node = graph.getNode(packageName);
        if (!node) {
            console.error(`Node for ${packageName} not found`);
            process.exit(1);
        }
        const graphData = graph.backtrack(node, 1);
        const importsCategories: Record<string, string[]> = {};
        for (const link of graphData.links) {
            const imports = await extractPackageImports(link.source, link.target, pnpmLsObject);
            imports.forEach((imp: string) => {
                if (!importsCategories[imp]) {
                    importsCategories[imp] = [];
                }
                importsCategories[imp].push(link.source);
            });
        }
        console.log('---------------------------------------');
        console.log(importsCategories);
    });
