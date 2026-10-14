import type {
    IdlV00,
    IdlV00Event,
    IdlV00EventField,
    IdlV00TypeDef,
    IdlV00TypeDefTyStruct,
} from '@codama/nodes-from-anchor';
import { rootNodeFromAnchor } from '@codama/nodes-from-anchor';
import { renderVisitor as renderJavaScriptUmiVisitor } from '@codama/renderers-js-umi';
import { camelCase, createFromRoot } from 'codama';
import * as fs from 'node:fs';
import * as path from 'path';
import readline from 'readline';
import { $ } from 'zx';

import { resolvePackageDir } from '@layerzerolabs/repo-utils';

import { addresses } from '../addresses';

/**
 * Modifies the IDL JSON file by converting events to type definitions
 * This function reads an IDL file and transforms all event definitions into type definitions
 * by moving them from the 'events' array to the 'types' array. This is necessary because
 * the code generation tool expects event structures to be defined as types rather than events.
 *
 * @param path - Path to the IDL JSON file to be modified
 * @returns Modified IDL object with events converted to types
 */
function transformEventsToTypes(idlFilePath: string): IdlV00 & { address?: string } {
    const content = fs.readFileSync(idlFilePath, 'utf8');
    const idl = JSON.parse(content) as IdlV00;
    const types = idl.types ?? [];
    const existingTypeNames = new Set(types.map((t) => t.name));
    const { events } = idl;
    if (events) {
        for (const event of events) {
            const { name, fields } = event;
            // Skip if a type with the same name already exists in the IDL
            if (existingTypeNames.has(name)) {
                continue;
            }
            // Some Anchor IDLs may omit event fields; only convert when fields exist
            if (!fields || fields.length === 0) {
                continue;
            }
            const typeFields: IdlV00EventField[] = fields;
            const typeSubItem: IdlV00TypeDefTyStruct = {
                kind: 'struct',
                fields: typeFields,
            };
            const newType: IdlV00TypeDef = {
                name: name,
                type: typeSubItem,
            };
            types.push(newType);
            existingTypeNames.add(name);
        }
    }
    return idl;
}

/**
 * move generated event files to events folder
 * @param generatedSDKDir generated sdk directory
 */
async function moveGenEventFiles(generatedSDKDir: string, events: IdlV00Event[]): Promise<void> {
    const generatedTypesDir = path.join(generatedSDKDir, 'types');
    const generatedEventsDir = path.join(generatedSDKDir, 'events');
    //special event names which are not end with Event
    // const specialEventNames = ['OFTSent', 'OFTReceived']
    const index = 'index.ts';

    // if types folder not exist, return directly
    if (!fs.existsSync(generatedTypesDir)) {
        return;
    }

    //get all event file names
    const eventFileNames = events.map((event) => {
        const { name } = event;
        return `${camelCase(name)}.ts`;
    });
    if (eventFileNames.length > 0) {
        if (!fs.existsSync(generatedEventsDir)) {
            fs.mkdirSync(generatedEventsDir);
        }
        eventFileNames.forEach((fileName) => {
            const originalPath = path.join(generatedTypesDir, fileName);
            const newPath = path.join(generatedEventsDir, fileName);
            //move event file from types to events
            fs.renameSync(originalPath, newPath);
            //fix event file issue
            fixEventFiles(newPath);
        });

        //move invalid lines from types/index.ts to events/index.ts
        const needMoveLines: string[] = [];
        const typesIndexFileReadStream = fs.createReadStream(path.join(generatedTypesDir, index));
        const typesInvalidLines = readline.createInterface({
            input: typesIndexFileReadStream,
            crlfDelay: Infinity,
        });
        const newTypeIndexFileLines: string[] = [];
        for await (const line of typesInvalidLines) {
            let invalid = false;
            events.forEach((event) => {
                if (line.endsWith(`${camelCase(event.name)}';`)) {
                    needMoveLines.push(line);
                    invalid = true;
                }
            });

            if (!invalid) {
                newTypeIndexFileLines.push(line);
            }
        }
        // first: remove invalid lines from types/index.ts.
        fs.writeFileSync(
            path.join(generatedTypesDir, index),
            newTypeIndexFileLines.join('\n'),
            'utf8',
        );
        typesIndexFileReadStream.close();

        // second: add invalid lines to events/index.ts.
        fs.writeFileSync(path.join(generatedEventsDir, index), needMoveLines.join('\n'), 'utf8');
    }
}

/**
 * some event file need to import types from types folder, but they are not in the same folder now, so fix it
 * @param path
 */
function fixEventFiles(path: string): void {
    let content = fs.readFileSync(path, 'utf8');
    if (content.includes("from '.'")) {
        content = content.replace("from '.'", "from '../types'");
        fs.writeFileSync(path, content, 'utf8');
    }
}

async function generateTypeScriptSDK(workDir: string, programName: string): Promise<void> {
    const generatedSDKDir = path.join(workDir, 'src', 'generated', programName);
    const anchorIdlPath = path.join(workDir, 'artifacts', `${programName}.json`);
    const anchorIdl = transformEventsToTypes(anchorIdlPath);

    anchorIdl.metadata = {
        ...anchorIdl.metadata,
        address: addresses[programName as keyof typeof addresses] || anchorIdl.address,
    };

    console.error('Generating TypeScript SDK to %s. IDL from %s', generatedSDKDir, anchorIdlPath);
    const codama = createFromRoot(rootNodeFromAnchor(anchorIdl));
    await codama.accept(renderJavaScriptUmiVisitor(generatedSDKDir));
    await moveGenEventFiles(generatedSDKDir, anchorIdl.events ?? []);
    await addTypeIgnoreComments(generatedSDKDir);
}

/**
 * Add TypeScript ignore comments to all generated files
 *
 * The codama-generated TypeScript files contain type errors
 * Since these are auto-generated files that we don't manually edit, and the runtime
 * behavior is correct, we add @ts-nocheck to skip TypeScript's type checking entirely.
 * This allows the build process to complete successfully while maintaining type safety
 * for our hand-written code.
 *
 * @param generatedSDKDir generated sdk directory
 */
async function addTypeIgnoreComments(generatedSDKDir: string): Promise<void> {
    const addIgnoreToFile = (filePath: string): void => {
        const content = fs.readFileSync(filePath, 'utf8');
        if (content.includes('// @ts-nocheck')) return; // Already has ignore comment

        const newContent = `// @ts-nocheck\n/* eslint-disable */\n${content}`;
        fs.writeFileSync(filePath, newContent, 'utf8');
    };

    const processDirectory = (dir: string): void => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);

            if (stat.isDirectory()) {
                processDirectory(filePath);
            } else if (file.endsWith('.ts')) {
                addIgnoreToFile(filePath);
            }
        }
    };

    if (fs.existsSync(generatedSDKDir)) {
        processDirectory(generatedSDKDir);
    }
}

export async function generateTypeScriptSDKs(
    programs: string[],
    packageName: string,
): Promise<void> {
    const pkgRoot = resolvePackageDir(packageName);

    await Promise.all(programs.map((program) => generateTypeScriptSDK(pkgRoot, program)));
}

interface FeatureInfo {
    description: string;
    id: string;
    status: string;
}

interface FeaturesResponse {
    features: FeatureInfo[];
}

export async function generateFeatures() {
    console.log('🔍 Retrieving mainnet feature flags...');

    try {
        // Retrieve the list of inactive features from the mainnet-beta cluster
        // Try multiple RPC endpoints for reliability
        const rpcEndpoints = [
            'https://api.mainnet-beta.solana.com',
            'https://solana-rpc.publicnode.com',
            'https://rpc.ankr.com/solana',
        ];

        let features: FeaturesResponse | null = null;
        let lastError: unknown = null;

        for (const rpc of rpcEndpoints) {
            try {
                console.log(`Trying ${rpc}...`);

                const featuresStatusJson = 'features-status.json';
                const featuresStatusJsonPath = path.join(process.cwd(), `./${featuresStatusJson}`);

                // Dumps features status to file
                await $`lz-tool --script 'solana feature status -u ${rpc} --display-all --output json-compact > ${featuresStatusJson}' anchor`;

                console.log(`Reading json from ${featuresStatusJsonPath}`);
                features = JSON.parse(fs.readFileSync(featuresStatusJsonPath, 'utf-8'));

                break;
            } catch (error) {
                lastError = error;
                console.log(`  Failed with ${rpc}, trying next...`);
            }
        }

        if (!features) {
            throw lastError || new Error('All RPC endpoints failed');
        }

        // Filter only inactive features (these are the ones we need to deactivate in test validator)
        const inactiveFeatures = features.features.filter((f) => f.status === 'inactive');

        console.log(`📊 Found ${inactiveFeatures.length} inactive features`);

        const targetDir = path.join(process.cwd(), './test-artifacts');
        console.log('targetDir', targetDir);
        const featuresFile = path.join(targetDir, 'features.json');

        // Ensure directory exists
        fs.mkdirSync(targetDir, { recursive: true });

        // Write features data with metadata
        const featuresData = {
            timestamp: new Date().toISOString(),
            source: 'https://solana-rpc.publicnode.com',
            totalFeatures: features.features.length,
            inactiveFeatures: inactiveFeatures,
            inactiveCount: inactiveFeatures.length,
        };

        fs.writeFileSync(featuresFile, JSON.stringify(featuresData, null, 2));

        console.log(`✅ Features data saved to ${featuresFile}`);
        console.log(
            `📝 Cached ${inactiveFeatures.length} inactive features for faster test startup`,
        );
    } catch (error) {
        console.error('❌ Failed to retrieve features:', error);
        process.exit(1);
    }
}
