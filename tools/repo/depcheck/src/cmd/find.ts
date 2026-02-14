import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import ts from 'typescript';

import { findConfigsInDir } from '../find';
import { Trie } from '../trie';
import type { PnpmPackageObject } from '../types';
import { getPnpmLs } from '../utils';

export const findCmd = new Command('find')
    .description('Find and visualize config files in tree')
    .option(
        '--common-configs <pattern>',
        'configs names that are shared between different packages and the find config need to return the parrent directory as well',
        'localnet,mainnet,testnet,sandbox,index,model,factory,config,src',
    )
    .option('--keywords <keywords>', 'keywords to search to find configs')
    .action(async (options) => {
        const { pnpmLs, pnpmLsObject } = await getPnpmLs();
        let packages: string[] = pnpmLs.map((p) => p.name).filter((x) => x !== 'root');
        console.log(`📦 Found ${packages.length} packages to scan`);

        const trie = new Trie();
        const filenames = new Set<string>();
        const commonConfigs: string[] = options.commonConfigs.split(',');
        const keywords = options.keywords ? options.keywords.split(',') : [];

        for (const p of packages) {
            const configs = await findConfigs(p, pnpmLsObject);
            for (const config of Object.keys(configs)) {
                for (const path of configs[config]) {
                    let splited_path = path.split('/');
                    let i = 1;
                    while (
                        i < splited_path.length &&
                        commonConfigs.some((config: string) =>
                            splited_path[splited_path.length - i].match(new RegExp(config)),
                        )
                    ) {
                        i++;
                    }
                    let filename = splited_path.slice(-i).join('/');
                    filenames.add(filename);
                    if (options.keywords) {
                        if (keywords.some((keyword: string) => path.match(new RegExp(keyword)))) {
                            trie.insert(path, p);
                        }
                    } else {
                        trie.insert(path, p);
                    }
                }
            }
        }

        trie.print();
        const sortedFilenames = Array.from(filenames).sort((a, b) =>
            a.toLowerCase().localeCompare(b.toLowerCase()),
        );
        console.log(`Found ${sortedFilenames.length} config files:`);

        sortedFilenames.forEach((filename) => {
            console.log(`- ${filename}`);
        });
    });

const findConfigs = async (
    packageName: string,
    pnpmLsObject: { [key: string]: PnpmPackageObject },
) => {
    const packageJsonPath = path.dirname(path.join(pnpmLsObject[packageName].path, 'package.json'));

    let catConfig: Record<string, string[]> = {};

    let configs: string[] = [];
    try {
        // Pass the package root as rootDir to load .gitignore patterns once
        const rootDir = pnpmLsObject.root?.path || packageJsonPath;
        configs = await findConfigsInDir(packageJsonPath, rootDir);
    } catch (error) {
        console.error(`Error reading directory for package ${packageName}:`, error);
        return catConfig;
    }

    const mainnetConfig = configs.filter((file) => file.match(/mainnet/i));
    const localnetConfig = configs.filter((file) => file.match(/localnet/i));
    const testnetConfig = configs.filter((file) => file.match(/testnet/i));
    const sandboxConfig = configs.filter((file) => file.match(/sandbox/i));
    const restofJsonConfigs = configs.filter(
        (file) => !file.match(/mainnet|localnet|testnet|sandbox/i) && file.endsWith('.json'),
    );
    const tsConfigs = configs.filter(
        (file) => !file.match(/mainnet|localnet|testnet|sandbox/i) && file.endsWith('.ts'),
    );

    // these are the ts configs that have a config object in them
    let configFiles = await Promise.all(
        tsConfigs.map(async (file) => {
            const content = await fs.readFile(path.join(packageJsonPath, file), 'utf-8');
            const ast = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);

            let hasConfig = false;

            const visit = (node: ts.Node) => {
                // if the node is an object literal expression and has properties, then it has a config object
                // which means the node x in AST is an object. for example
                // export config = { key : 1 }
                if (ts.isObjectLiteralExpression(node)) {
                    // if the object literal expression has properties, then the file maybe has a config object
                    if (node.properties.length > 0) {
                        hasConfig = true;
                    }
                }
                ts.forEachChild(node, visit);
            };
            ts.forEachChild(ast, visit);

            return { file, hasConfig };
        }),
    );

    let maybeConfigFiles = configFiles.filter((file) => file.hasConfig).map((file) => file.file);

    let restofTsConfigs = configFiles.filter((file) => !file.hasConfig).map((file) => file.file);

    if (mainnetConfig.length > 0) {
        catConfig['mainnet'] = mainnetConfig;
    }
    if (localnetConfig.length > 0) {
        catConfig['localnet'] = localnetConfig;
    }
    if (testnetConfig.length > 0) {
        catConfig['testnet'] = testnetConfig;
    }
    if (sandboxConfig.length > 0) {
        catConfig['sandbox'] = sandboxConfig;
    }
    if (restofJsonConfigs.length > 0) {
        catConfig['json'] = restofJsonConfigs;
    }
    if (maybeConfigFiles.length > 0) {
        catConfig['ts-maybe-config'] = maybeConfigFiles;
    }
    if (restofTsConfigs.length > 0) {
        catConfig['rest-of-ts'] = restofTsConfigs;
    }

    return catConfig;
};
