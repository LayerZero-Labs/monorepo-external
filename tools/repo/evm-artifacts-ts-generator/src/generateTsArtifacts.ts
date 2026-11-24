import { promises as fs } from 'fs';
import Handlebars from 'handlebars';
import url from 'node:url';
import * as path from 'path';

import {
    type AbiBytecodeJson,
    type BuildInfoJson,
    EVMBuildTarget,
    FileNames,
} from '@layerzerolabs/common-evm';

import {
    type ArtifactConfig,
    type ContractBuildTargetInfo,
    type ContractInfo,
    Templates,
} from './types';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUILD_TARGET_LABEL: Record<EVMBuildTarget, string> = {
    default: 'Default',
    tron: 'Tron',
    zksync: 'ZKsync',
};

const CONFIGS: Record<EVMBuildTarget, (packagePath: string, outputDir: string) => ArtifactConfig> =
    {
        default: (packagePath, outputDir) => ({
            artifactsDir: path.resolve(packagePath, 'artifacts'),
            outputDir,
            generatedDir: path.resolve(packagePath, 'src', 'generated-abi'),
            abiImportPrefix: '../generated-abi',
        }),
        tron: (packagePath, outputDir) => ({
            artifactsDir: path.resolve(packagePath, 'artifacts-tron'),
            outputDir,
            generatedDir: path.resolve(packagePath, 'src', 'generated-abi'),
            abiImportPrefix: '../generated-abi',
            flattenedSolSupport: true,
        }),
        zksync: (packagePath, outputDir) => ({
            artifactsDir: path.resolve(packagePath, 'artifacts-zk'),
            outputDir,
            generatedDir: path.resolve(packagePath, 'src', 'generated-abi'),
            abiImportPrefix: '../generated-abi',
        }),
    };

// Register helpers used in templates
Handlebars.registerHelper('jsonStringify', (value: unknown) => JSON.stringify(value));

async function _loadTemplate(templateFileName: Templates): Promise<Handlebars.TemplateDelegate> {
    const templatePath = path.resolve(__dirname, 'templates', templateFileName);
    const templateSource = await fs.readFile(templatePath, 'utf8');
    return Handlebars.compile(templateSource);
}

async function readJson<T>(file: string): Promise<T> {
    const data = await fs.readFile(file, 'utf8');

    return JSON.parse(data) as T;
}

async function createDirectory(dir: string) {
    // Clean up the directory first before creating it
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
}

/**
 * Collect all files in a directory
 *
 * @param dir The directory to collect files from
 * @returns
 */
async function _collectFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await _collectFiles(full)));
        } else if (entry.isFile()) {
            files.push(full);
        }
    }

    return files;
}

/**
 * Resolve the ABI import path for a given contract name
 *
 * @param config The artifact config
 * @param contractName
 * @returns The ABI import path
 */
async function _resolveAbiImportPath(
    config: ArtifactConfig,
    contractName: string,
): Promise<string | undefined> {
    try {
        const files = await _collectFiles(config.generatedDir);
        const match = files.find((f) =>
            f.endsWith(path.join(contractName, `${contractName}Abi.ts`)),
        );
        if (!match) {
            return;
        }

        // Import path should be relative to the outDir and without extension
        const withoutExt = match.slice(0, -3);
        let rel = path.relative(config.outputDir, withoutExt);

        rel = rel.split(path.sep).join('/');
        return rel;
    } catch {
        return;
    }
}

/**
 * Generate a wagmi/cli ABI export identifier from a contract name.
 *
 * @param contractName The contract name
 * @returns The ABI export identifier
 */
function generateAbiIdentifier(contractName: string): string {
    if (!contractName) {
        throw new Error('generateAbiIdentifier: Contract name cannot be empty');
    }

    // Strip underscores to match wagmi's camelCase conversion, which also strips them.
    // e.g., HyperLiquidComposer_V1 → HyperLiquidComposerV1 → hyperLiquidComposerV1Abi
    const normalized = contractName.replace(/_/g, '');

    // Convert consecutive uppercase runs that precede either a normal word start (A followed by a-z)
    // or digits, or the end of the string into TitleCase for that run (e.g., OFT -> Oft, ERC20 -> Erc20),
    // then lower-case only the first character of the full identifier.
    // For eg: MyOFTToken -> myOFTTokenAbi
    const camelizedAcronyms = normalized.replace(
        /([A-Z]+)(?=(?:[A-Z][a-z]|\d|$))/g,
        (m) => m[0] + m.slice(1).toLowerCase(),
    );

    const camelCase = camelizedAcronyms[0].toLowerCase() + camelizedAcronyms.slice(1);
    return `${camelCase}Abi`;
}

/**
 * Recursively collect all files named "abiBytecode.json"
 *
 * @returns The list of files
 */
async function collectAbiBytecodeFiles(dir: string): Promise<string[]> {
    const abiBytecodeFiles: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            abiBytecodeFiles.push(...(await collectAbiBytecodeFiles(full)));
        } else if (entry.isFile() && entry.name === `${FileNames.ABI_BYTECODE}.json`) {
            abiBytecodeFiles.push(full);
        }
    }

    return abiBytecodeFiles;
}

/**
 * Given a path to abiBytecode.json, return the sibling buildInfo.json file if exists.
 */
async function getSiblingBuildInfo(abiPath: string): Promise<BuildInfoJson | undefined> {
    const dir = path.dirname(abiPath);
    const buildInfoPath = path.join(dir, `${FileNames.BUILD_INFO}.json`);

    let buildInfo: BuildInfoJson | undefined;

    try {
        buildInfo = await readJson<BuildInfoJson>(buildInfoPath);
    } catch {}

    return buildInfo;
}

/**
 * TypeScript source for <Contract>.artifact.ts.
 */
async function buildArtifactTs(
    contractName: string,
    abiIdentifier: string,
    abiImportPath: string,
    bytecode: string,
    sourceName?: string,
    deployedBytecode?: string,
    buildInfo?: BuildInfoJson,
    flattenedSol?: unknown,
): Promise<string> {
    const template = await _loadTemplate(Templates.ARTIFACT);
    return template({
        contractName,
        abiIdentifier,
        abiImportPath,
        bytecode,
        sourceName,
        deployedBytecode,
        buildInfo,
        flattenedSol,
    });
}

/**
 * Emit the per-contract artifact file.
 */
async function writeContractArtifactFile(
    outDir: string,
    contractName: string,
    buildTarget: EVMBuildTarget,
    abiId: string,
    abiImportPath: string,
    bytecode: string,
    sourceName: string,
    deployedBytecode?: string,
    buildInfo?: BuildInfoJson,
    flattenedSol?: unknown,
) {
    const artifactTs = await buildArtifactTs(
        contractName,
        abiId,
        abiImportPath,
        bytecode,
        sourceName,
        deployedBytecode,
        buildInfo,
        flattenedSol,
    );
    const artifactFile = path.join(outDir, `${contractName}.${buildTarget}.artifact.ts`);
    await fs.writeFile(artifactFile, artifactTs, 'utf8');
}

/**
 * Write the index.ts file with enhanced contract types for all build targets.
 */
async function writeEnhancedContractTypes(contracts: ContractInfo[], outDir: string) {
    const template = await _loadTemplate(Templates.INDEX);

    const templateContracts = contracts.map((contract) => {
        const targets = Object.entries(contract.buildTargets) as [
            EVMBuildTarget,
            ContractBuildTargetInfo,
        ][];
        return {
            name: contract.name,
            abiId: contract.abiId,
            abiImportPath: contract.abiImportPath,
            anyHasFlattenedSol: targets.some(([, info]) => info.hasFlattenedSol),
            buildTargets: targets.map(([target, info]) => ({
                enumKey: target.toUpperCase(),
                alias: `_${contract.name}${BUILD_TARGET_LABEL[target]}Artifact`,
                artifactFileName: info.artifactFileName,
                isZkChain: target === EVMBuildTarget.ZKSYNC,
                hasFlattenedSol: info.hasFlattenedSol,
            })),
        };
    });

    const contractsTs = template({ contracts: templateContracts });
    const contractsPath = path.join(outDir, 'index.ts');

    await fs.writeFile(contractsPath, contractsTs, 'utf8');
}

async function checkIfDirExists(dir: string): Promise<boolean> {
    try {
        await fs.stat(dir);
        return true;
    } catch {
        return false;
    }
}

async function resolveFlattenedSolPath(
    abiFile: string,
    contractName: string,
    outputDir: string,
): Promise<string | undefined> {
    try {
        const dir = path.dirname(abiFile);
        const flattenedPathFs = path.join(dir, `${contractName}.flattened.sol.json`);
        await fs.stat(flattenedPathFs);
        let rel = path.relative(outputDir, flattenedPathFs);
        rel = rel.split(path.sep).join('/');
        return rel;
    } catch {
        return undefined;
    }
}

interface ProcessedContract {
    contractName: string;
    abiId: string;
    abiImportPath: string;
    hasFlattenedSol: boolean;
}

/**
 * Generates strictly typed evm artifacts for a single build target.
 * It generates the abiBytecode + buildInfo + flattenedSol etc. and uses the `oViem` internally.
 *
 * @param config Given artifact config
 * @param buildTarget The build target key
 * @returns Processed contract metadata for index generation
 */
async function generateTargetTsArtifacts(
    config: ArtifactConfig,
    buildTarget: EVMBuildTarget,
): Promise<ProcessedContract[]> {
    const artifactsDirExists = await checkIfDirExists(config.artifactsDir);
    const abiBytecodeFiles = artifactsDirExists
        ? await collectAbiBytecodeFiles(config.artifactsDir)
        : [];

    if (abiBytecodeFiles.length === 0) {
        console.warn(
            `[WARN] No abiBytecode.json files found in ${path.basename(config.artifactsDir)} directory, skipping ${buildTarget}...`,
        );
        return [];
    }

    // Process all artifact files
    const results = await Promise.all(
        abiBytecodeFiles.map(async (abiFile) => {
            const abiJson = await readJson<AbiBytecodeJson>(abiFile);
            const contractName = abiJson.contractName;

            if (!contractName) {
                return;
            }

            const abiId = generateAbiIdentifier(contractName);
            const abiImportPath =
                (await _resolveAbiImportPath(config, contractName)) ??
                `${config.abiImportPrefix}/${contractName}/${contractName}Abi`;
            const buildInfo = await getSiblingBuildInfo(abiFile);

            let flattenedSol: unknown;
            let hasFlattenedSol = false;
            if (config.flattenedSolSupport) {
                const flattenedSolPath = await resolveFlattenedSolPath(
                    abiFile,
                    contractName,
                    config.outputDir,
                );
                if (flattenedSolPath) {
                    hasFlattenedSol = true;
                    flattenedSol = await readJson<unknown>(
                        path.resolve(config.outputDir, flattenedSolPath),
                    );
                }
            }

            await writeContractArtifactFile(
                config.outputDir,
                contractName,
                buildTarget,
                abiId,
                abiImportPath,
                abiJson.bytecode,
                abiJson.sourceName ?? '',
                abiJson.deployedBytecode,
                buildInfo,
                flattenedSol,
            );

            return {
                contractName,
                abiId,
                abiImportPath,
                hasFlattenedSol,
            } satisfies ProcessedContract;
        }),
    );

    return results.filter((r): r is ProcessedContract => r != null);
}

function getOrCreateContractInfo(
    contractMap: Map<string, ContractInfo>,
    contract: ProcessedContract,
): ContractInfo {
    const existing = contractMap.get(contract.contractName);
    if (existing) {
        return existing;
    }

    const info: ContractInfo = {
        name: contract.contractName,
        abiId: contract.abiId,
        abiImportPath: contract.abiImportPath,
        buildTargets: {},
    };
    contractMap.set(contract.contractName, info);
    return info;
}

async function generateTsArtifacts(packagePath: string): Promise<void> {
    const outputDir = path.resolve(packagePath, 'src', 'generated-artifacts');
    await createDirectory(outputDir);

    const contractMap = new Map<string, ContractInfo>();
    const buildTargetKeys = Object.values(EVMBuildTarget);

    for (const buildTarget of buildTargetKeys) {
        const config = CONFIGS[buildTarget](packagePath, outputDir);
        const processed = await generateTargetTsArtifacts(config, buildTarget);

        for (const contract of processed) {
            const info = getOrCreateContractInfo(contractMap, contract);

            info.buildTargets[buildTarget] = {
                artifactFileName: `${contract.contractName}.${buildTarget}.artifact`,
                hasFlattenedSol: contract.hasFlattenedSol,
            };
        }
    }

    const contracts = Array.from(contractMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    if (contracts.length === 0) {
        console.warn(`[WARN] No contracts found for any build target, skipping index generation.`);
        return;
    }

    // Write the unified index file with enhanced contract types
    await writeEnhancedContractTypes(contracts, outputDir);
}

export { generateTsArtifacts };
