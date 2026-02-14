import { Command } from 'commander';

import { exportToGithub } from '../export';
import { buildGraph } from '../graph';
import { checkAccess, getPnpmLs, getPrivateDepsFixSuggestion, isPackagePublic } from '../utils';

export const exportAction = async (packageNames: string, options: any) => {
    const { remote, branch, message, author, email, allPublic, exclude } = options;
    const excludePackages: string[] = exclude ? exclude.split(',') : [];
    const { pnpmLs, pnpmLsObject } = await getPnpmLs();
    let packages: string[] = pnpmLs.map((p) => p.name).filter((x) => x !== 'root');

    const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

    let toPublish: string[] = [];

    if (!allPublic && !packageNames.length) {
        console.error('Either a package name or --all-public option is required');
        process.exit(1);
    }

    if (!GITHUB_TOKEN) {
        console.error('GITHUB_TOKEN environment variable is not set');
        process.exit(1);
    }

    if (packageNames) {
        toPublish = packageNames.split(',');
    }

    if (allPublic) {
        for (const packageName of packages) {
            const isPublic = await isPackagePublic(packageName, pnpmLsObject);
            if (isPublic) {
                toPublish.push(packageName);
            }
        }
    }

    const graph = await buildGraph(packages, {}, pnpmLsObject);

    const exportPackage = async (packageNames: string[]) => {
        for (const packageName of packageNames) {
            const subgraph = graph.extractSubgraph(graph.getNode(packageName)!);
            const failed = await checkAccess(subgraph, pnpmLsObject, isPackagePublic);

            if (failed) {
                throw new Error(
                    getPrivateDepsFixSuggestion(
                        `🚨🔒 ${packageName} has private dependencies`,
                        packageName,
                    ),
                );
            }
        }

        await exportToGithub(packageNames, pnpmLsObject, {
            remote,
            branch,
            commitMessage: message,
            githubToken: GITHUB_TOKEN,
            author: {
                name: author,
                email,
            },
        });
    };

    if (exclude) {
        toPublish = toPublish.filter((x) => !excludePackages.includes(x));
    }

    await exportPackage(toPublish);
};

export const exportCmd = new Command('export')
    .description('Export packages to external GitHub repository')
    .option('-r, --remote <remote>', 'remote url')
    .option('-b, --branch <branch>', 'branch name')
    .option('-m, --message <message>', 'commit message')
    .option('-a, --author <author>', 'author name')
    .option('-e, --email <email>', 'author email')
    .option('--all-public', 'export all public packages')
    .option('--exclude <exclude>', 'exclude packages')
    .argument('[package]', 'package name')
    .action(exportAction);
