import { Command } from 'commander';

import { updateDeps } from '../deps';
import { buildGraph } from '../graph';
import { safeRegexMatch } from '../safeRegex';
import { Direction, type GraphData, type PackageJson } from '../types';
import { getCachedCatalog, getPnpmLs } from '../utils';
import { buildOutputPath, openInBrowser, writeVisualization } from '../visualize';

export const visualizeCmd = new Command('visualize')
    .description('Generate interactive HTML dependency graph visualization')
    .option('--from <package>', 'Start from a specific package (show what it depends on)')
    .option('--used-by <package>', 'Alias for --from (show packages used by X)')
    .option('--to <package>', 'End at a specific package (show what depends on it)')
    .option('--uses <package>', 'Alias for --to (show packages that use X)')
    .option('--depth <depth>', 'Depth of dependencies to visualize', '1')
    .option('--regex <regex>', 'Regex to filter packages')
    .option('--update-deps', 'update dependencies')
    .option('--only <name>', 'Check only this workspace package (by exact name or regex pattern).')
    .option('--ignore <ignore>', 'ignore packages')
    .option('--only-internal', 'only include internal packages local to this repository')
    .option(
        '--ignore-patterns <patterns...>',
        'space-separated glob patterns to ignore in depcheck (e.g., docker/evm/script_that_runs_within_contrainer.ts)',
    )
    .option('--no-open', 'do not open the generated HTML in browser')
    .action(async (options) => {
        if (options.from && options.usedBy) {
            throw new Error('--from and --used-by are aliases, provide only one');
        }
        if (options.to && options.uses) {
            throw new Error('--to and --uses are aliases, provide only one');
        }

        const from = options.from || options.usedBy;
        const to = options.to || options.uses;

        if (!!from === !!to) {
            throw new Error('Exactly one of --from/--used-by or --to/--uses must be provided');
        }

        const { pnpmLs, pnpmLsObject } = await getPnpmLs();
        const catalog = await getCachedCatalog();
        let packages: string[] = pnpmLs.map((p) => p.name).filter((x) => x !== 'root');

        if (options.onlyInternal) {
            packages = packages.filter((p) => {
                // Ignore the catalog packages
                if (catalog[p]) {
                    return false;
                }

                // Check only for the layerzero packages that are left and not in the catalog
                if (p.startsWith('@layerzerolabs/')) {
                    return true;
                }

                // Ignore the packages that are left out, could be node funcs, or others etc.
                return false;
            });
        }

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

        const depth = parseInt(options.depth);
        const rootPath = pnpmLsObject['root'].path;
        const templateDir = process.cwd();

        let outputPath: string;
        const direction = from ? Direction.From : Direction.To;
        let graphData: GraphData;
        if (from) {
            let filters = from.split(',');
            let vizPackages: string[] = [];
            if (!options.noRegex) {
                vizPackages = packages.filter((p) =>
                    filters.some((f: string) => safeRegexMatch({ str: p, pattern: f })),
                );
            } else {
                vizPackages = packages.filter((p) => filters.some((f: string) => p === f));
            }
            graphData = graph.visualizeFrom(vizPackages, depth);
        } else {
            graphData = graph.visualizeTo([to], depth);
        }

        const pkg = graphData.packageName;
        outputPath = buildOutputPath({ rootPath, depth, direction, pkg });
        await writeVisualization({ graphData, outputPath, templateDir, depth, direction });

        if (options.open) {
            openInBrowser(outputPath);
        }
    });
