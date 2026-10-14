import * as fs from 'fs/promises';
import * as path from 'path';
import * as prettier from 'prettier';

import {
    extractEvents,
    generateAllConstructorCodes,
    generateAllDeconstructorCodes,
    generateAllTonClassTypes,
    getSpecificFiles,
    mergeConstructorDicts,
    parseDirectory,
    saveEventsFile,
    saveObjectsAsTS,
} from '@layerzerolabs/ton-sdk-tools';

import { extractErrors, extractOpcodes, saveConstantsFile } from './tonUtils';
import type { ContractConfig, PostGenerateOperationsInput } from './types';
import { ensureDirExists, ensureFileExists, fileExists, makeReExportFile } from './utils';

export const copyTonContractArtifacts = async (
    resolvePath: (relativePathWithinPackage: string) => string,
    rootPath: string,
    pkgName: string,
    contract: ContractConfig,
    contractPath: string = 'contracts',
) => {
    const packagePath = path.dirname(resolvePath(`${pkgName}/package.json`));
    const srcGenerated = path.join(packagePath, 'build');
    const outSrc = path.join(rootPath, 'src');
    const outGenerated = path.join(outSrc, 'generated', contractPath);
    await ensureDirExists(outSrc);
    await ensureDirExists(outGenerated);
    const contractFile = contract.file;
    if (!contractFile) {
        throw new Error(`Contract file not found for contract: ${contract.name}`);
    }
    const srcPath = path.join(srcGenerated, contractFile);
    if (!(await fileExists(srcPath))) {
        throw new Error(`Contract artifact not found: ${srcPath}`);
    }
    const dstPath = path.join(outGenerated, contractFile);
    await fs.copyFile(srcPath, dstPath);
};

const toCamelCase = (name: string): string => {
    return name.replace(/^[A-Z]/, (character) => character.toLowerCase());
};

export const createTonContractIndex = async (
    rootPath: string,
    contracts: ContractConfig[],
    contractPath: string = 'contracts',
) => {
    const outSrc = path.join(rootPath, 'src');
    const outGenerated = path.join(outSrc, 'generated', contractPath);
    await ensureDirExists(outSrc);
    await ensureDirExists(outGenerated);

    const indexFile = path.join(outGenerated, 'index.ts');
    await ensureFileExists(indexFile);
    const indexContent = contracts
        .map(
            (contract) =>
                `export { default as ${contract.name}Artifact } from './${contract.file}';`,
        )
        .sort()
        .join('\n');
    await fs.writeFile(indexFile, indexContent, 'utf-8');
};

export const copyTonHelpers = async (
    resolvePath: (relativePathWithinPackage: string) => string,
    rootPath: string,
    helpers: Record<string, { paths: string[]; name: string }[]>,
    hasContracts: boolean,
) => {
    const outSrc = path.join(rootPath, 'src');
    const outGenerated = path.join(outSrc, 'generated', 'helpers');
    await ensureDirExists(outSrc);
    await ensureDirExists(outGenerated);
    for (const [pkgName, helperPaths] of Object.entries(helpers)) {
        const packagePath = path.dirname(resolvePath(`${pkgName}/package.json`));
        for (const helper of helperPaths) {
            const helperName = toCamelCase(helper.name);
            const outGeneratedHelper = path.join(outGenerated, helperName);
            await ensureDirExists(outGeneratedHelper);
            const parsedObjects = helper.paths
                .map((_path) => parseDirectory(path.join(packagePath, _path)))
                .reduce((acc, curr) => mergeConstructorDicts(acc, curr), {});
            const withCtors = generateAllConstructorCodes(parsedObjects);
            const withTypes = generateAllTonClassTypes(withCtors);
            const parsedCodes = generateAllDeconstructorCodes(withTypes);
            saveObjectsAsTS(parsedCodes, outGeneratedHelper, 'allObjects.ts');
            const allFuncFiles = helper.paths.flatMap((_path) =>
                getSpecificFiles(path.join(packagePath, _path), '.fc'),
            );
            const opcodeConstants = extractOpcodes(allFuncFiles);
            const errorConstants = extractErrors(allFuncFiles);
            const eventConstants = extractEvents(allFuncFiles);
            saveConstantsFile(opcodeConstants, outGeneratedHelper, 'OPCODES', 'opcodes.ts');
            saveConstantsFile(errorConstants, outGeneratedHelper, 'ERRORS', 'errors.ts');
            saveEventsFile(eventConstants, outGeneratedHelper, 'EVENTS', 'events.ts');
            await makeReExportFile(outGeneratedHelper, ['opcodes', 'errors', 'events']);
        }
    }

    const indexFile = path.join(outSrc, 'generated', 'index.ts');
    await ensureFileExists(indexFile);
    const indexContent = [
        hasContracts ? "export * from './contracts';\n" : '',
        "import { generateDecodeClass, generateEncodeClass } from '@layerzerolabs/common-ton';\n",
        ...Object.entries(helpers).flatMap(([_, helperPaths]) =>
            helperPaths
                .map((helper) => toCamelCase(helper.name))
                .flatMap((helperName) => [
                    `import { tonObjects as ${helperName}TonObjects } from './helpers/${helperName}/allObjects';\n`,
                    `export const ${helperName}BuildClass = generateEncodeClass(${helperName}TonObjects);`,
                    `export const ${helperName}DecodeClass = generateDecodeClass(${helperName}TonObjects);\n`,
                    `export { EVENTS as ${helperName.toUpperCase()}_EVENTS } from './helpers/${helperName}/events';`,
                    `export { OPCODES as ${helperName.toUpperCase()}_OPCODES } from './helpers/${helperName}/opcodes';\n`,
                ]),
        ),
        "export { OPCODES } from '@layerzerolabs/lz-v2-protocol-ton';\n",
    ].join('\n');

    const options = await prettier.resolveConfig(process.cwd());
    const formatted = await prettier.format(indexContent, { parser: 'typescript', ...options });

    await fs.writeFile(indexFile, formatted, 'utf-8');
};

export const postGenerateOperationsTon = async ({
    resolvePath,
    packageRoot,
    artifactsPackageConfig,
}: PostGenerateOperationsInput) => {
    const contracts = Object.entries(artifactsPackageConfig.contracts).flatMap(
        ([_, contracts]) => contracts,
    );
    await createTonContractIndex(packageRoot, contracts);
    if (artifactsPackageConfig.helpers) {
        await copyTonHelpers(
            resolvePath,
            packageRoot,
            artifactsPackageConfig.helpers,
            contracts.length > 0,
        );
    }
};
