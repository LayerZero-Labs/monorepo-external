import fs from 'fs';
import * as path from 'path';

import { IdlV01, IdlV01Event, rootNodeFromAnchor } from '@codama/nodes-from-anchor';
import { renderVisitor as renderJavaScriptUmiVisitor } from '@codama/renderers-js-umi';
import { camelCase, createFromRoot } from 'codama';

/**
 * Parses an IDL JSON file and returns the IDL content
 * @param filePath - Path to the IDL file
 * @returns Parsed IDL object
 */
export function parseIdlFile(filePath: string): IdlV01 {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(content) as IdlV01;
    } catch (error: any) {
        throw new Error(`Failed to parse IDL file at ${filePath}: ${error.message}`);
    }
}

/**
 * Fixes import paths in event files
 * @param filePath - Path to the event file that needs fixing
 */
function fixEventFileImports(filePath: string): void {
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        if (content.includes("from '.'")) {
            content = content.replace("from '.'", "from '../types'");
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`Fixed imports in ${path.basename(filePath)}`);
        }
    } catch (error: any) {
        console.warn(`Warning: Failed to fix imports in ${filePath}: ${error.message}`);
    }
}

/**
 * Moves generated event files from 'types' folder to 'events' folder and fixes their imports
 * @param generatedSDKDir - Directory containing the generated SDK
 * @param events - List of events from the IDL
 */
export function moveEventFiles(generatedSDKDir: string, events: IdlV01Event[]): void {
    const typesDir = path.join(generatedSDKDir, 'types');
    const eventsDir = path.join(generatedSDKDir, 'events');
    const indexFile = 'index.ts';

    // Skip if types directory doesn't exist
    if (!fs.existsSync(typesDir)) {
        console.log('Types directory not found, skipping event file processing');
        return;
    }

    // Get event file names
    const eventFileNames = events.map((event) => `${camelCase(event.name)}.ts`);

    if (eventFileNames.length === 0) {
        console.log('No events to process');
        return;
    }

    // Create events directory if it doesn't exist
    if (!fs.existsSync(eventsDir)) {
        fs.mkdirSync(eventsDir);
        console.log(`Created events directory at ${eventsDir}`);
    }

    // Move each event file and fix its imports
    for (const fileName of eventFileNames) {
        const sourcePath = path.join(typesDir, fileName);
        const targetPath = path.join(eventsDir, fileName);

        try {
            if (fs.existsSync(sourcePath)) {
                fs.renameSync(sourcePath, targetPath);
                fixEventFileImports(targetPath);
                console.log(`Moved ${fileName} to events directory`);
            }
        } catch (error: any) {
            console.warn(`Warning: Couldn't move ${fileName}: ${error.message}`);
        }
    }

    // Update index files
    try {
        updateIndexFiles(typesDir, eventsDir, indexFile, events);
    } catch (error: any) {
        console.error(`Error updating index files: ${error.message}`);
    }
}

/**
 * Updates the index files in types and events directories
 * @param typesDir - Path to the types directory
 * @param eventsDir - Path to the events directory
 * @param indexFile - Name of the index file
 * @param events - List of events from the IDL
 */
function updateIndexFiles(
    typesDir: string,
    eventsDir: string,
    indexFile: string,
    events: IdlV01Event[],
): void {
    const typesIndexPath = path.join(typesDir, indexFile);
    const eventsIndexPath = path.join(eventsDir, indexFile);

    let fileContent: string;
    try {
        fileContent = fs.readFileSync(typesIndexPath, 'utf8');
    } catch {
        console.log('Types index file not found, skipping index update');
        return;
    }

    const lines = fileContent.split('\n');

    const linesToMove: string[] = [];
    const linesToKeep: string[] = [];

    for (const line of lines) {
        let shouldMove = false;
        for (const event of events) {
            if (line.endsWith(`${camelCase(event.name)}';`)) {
                linesToMove.push(line);
                shouldMove = true;
                break;
            }
        }

        if (!shouldMove) {
            linesToKeep.push(line);
        }
    }

    // Update the types index file
    fs.writeFileSync(typesIndexPath, linesToKeep.join('\n'), 'utf8');
    console.log('Updated types index file');

    // Create or update the events index file
    fs.writeFileSync(eventsIndexPath, linesToMove.join('\n'), 'utf8');
    console.log('Updated events index file');
}

/**
 * Waits for the specified duration
 * @param ms - Time to wait in milliseconds
 */
function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates TypeScript SDK from an IDL file
 */
async function generateTypeScriptSDK(): Promise<void> {
    try {
        const rootDir = path.join(__dirname, '..');
        const sdkDir = path.join(rootDir, 'src', 'generated');
        const idlPath = path.join(rootDir, 'build', 'onesig.json');

        console.log(`Starting SDK generation from IDL: ${idlPath}`);

        // Parse IDL file
        const idl = parseIdlFile(idlPath);

        console.log(`Generating TypeScript SDK to: ${sdkDir}`);

        // Create Kinobi root and generate SDK
        const kinobi = createFromRoot(rootNodeFromAnchor(idl));
        await kinobi.accept(renderJavaScriptUmiVisitor(sdkDir));

        // Allow time for file system operations to complete
        console.log('Waiting for file system operations to complete...');
        await delay(1000);

        // Process event files
        console.log('Processing event files...');
        moveEventFiles(sdkDir, idl.events ?? []);

        /**
         * This is a workaround for a TypeScript issue with the generated SDK.
         * The generated code has a type that is not compatible with the expected type.
         */
        (() => {
            const setParamsPath = path.join(sdkDir, 'types', 'setConfigParams.ts');
            const read = fs.readFileSync(setParamsPath, 'utf8');
            const replaced = read.replace(': Extract<SetConfigParamsArgs, { __kind: K }>', '');
            fs.writeFileSync(setParamsPath, replaced, 'utf8');
            console.log('Fixed setConfigParams.ts file');
        })();

        (() => {
            const setConfigPath = path.join(sdkDir, 'instructions', 'setConfig.ts');
            const read = fs.readFileSync(setConfigPath, 'utf8');
            const errorLine = `resolvedAccounts.oneSigSigner.value =`;
            const replaced = read.replace(errorLine, `// @ts-ignore\n${errorLine}`);
            fs.writeFileSync(setConfigPath, replaced, 'utf8');
            console.log('Fixed setConfig.ts file');
        })();

        console.log('TypeScript SDK generation completed successfully!');
    } catch (error: any) {
        console.error(`Error generating TypeScript SDK: ${error.message}`);
        throw error;
    }
}

// Main execution
if (require.main === module) {
    (async () => {
        try {
            await generateTypeScriptSDK();
            process.exit(0);
        } catch (error) {
            console.error('SDK generation failed:', error);
            process.exit(1);
        }
    })();
}

// Export for testing or external use
export { generateTypeScriptSDK };
