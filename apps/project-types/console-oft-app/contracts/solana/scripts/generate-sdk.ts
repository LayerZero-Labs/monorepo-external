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
import fs from 'fs';
import path from 'path';
import readline from 'readline';

/**
 * Strip Anchor generics that Codama can't parse.
 * RBAC macros produce generic Role params — we replace with u8 since
 * RoleType is #[repr(u8)].
 *
 * Three patterns to handle:
 * 1. Field type: {"generic":"Role"} → "u8"
 * 2. Type-level generics array on defined types (GrantRoleParams etc.)
 * 3. Instruction-level defined refs with generics array
 */
const sanitizeGenerics = (rawJson: string): string => {
    const idl = JSON.parse(rawJson);

    // Recursively replace {"generic":"Role"} with "u8" anywhere in the tree

    const walk = (obj: any): any => {
        if (obj === null || obj === undefined) return obj;
        if (Array.isArray(obj)) return obj.map(walk);
        if (typeof obj !== 'object') return obj;

        // Field-level generic → u8
        if (obj.generic === 'Role') return 'u8';

        // Strip "generics" arrays from type definitions and defined references
        // Rebuilt with fromEntries rather than assigned key by key: IDL keys are data.
        return Object.fromEntries(
            Object.entries(obj)
                .filter(([key]) => key !== 'generics')
                .map(([key, value]) => [key, walk(value)]),
        );
    };

    return JSON.stringify(walk(idl), null, 2);
};

/**
 * Converts IDL events into type definitions for Codama compatibility.
 */
const transformEventsToTypes = (idlFilePath: string): IdlV00 => {
    const idl = JSON.parse(sanitizeGenerics(fs.readFileSync(idlFilePath, 'utf8'))) as IdlV00;
    const types = idl.types ?? [];
    const existingTypeNames = new Set(types.map((t) => t.name));
    const { events } = idl;
    if (events) {
        for (const event of events) {
            const { name, fields } = event;
            if (existingTypeNames.has(name)) continue;
            if (!fields || fields.length === 0) continue;
            const typeFields: IdlV00EventField[] = fields;
            const typeSubItem: IdlV00TypeDefTyStruct = { kind: 'struct', fields: typeFields };
            const newType: IdlV00TypeDef = { name, type: typeSubItem };
            types.push(newType);
            existingTypeNames.add(name);
        }
    }
    return idl;
};

/**
 * Move generated event files to events folder.
 */
const moveGenEventFiles = async (generatedSDKDir: string, events: IdlV00Event[]): Promise<void> => {
    const generatedTypesDir = path.join(generatedSDKDir, 'types');
    const generatedEventsDir = path.join(generatedSDKDir, 'events');
    const index = 'index.ts';

    if (!fs.existsSync(generatedTypesDir)) {
        return;
    }

    const eventFileNames = events.map((event) => `${camelCase(event.name)}.ts`);
    if (eventFileNames.length > 0) {
        if (!fs.existsSync(generatedEventsDir)) {
            fs.mkdirSync(generatedEventsDir);
        }
        eventFileNames.forEach((fileName) => {
            const originalPath = path.join(generatedTypesDir, fileName);
            const newPath = path.join(generatedEventsDir, fileName);
            if (fs.existsSync(originalPath)) {
                fs.renameSync(originalPath, newPath);
                fixEventFiles(newPath);
            }
        });

        // Move invalid lines from types/index.ts to events/index.ts
        const needMoveLines: string[] = [];
        const typesIndexFileReadStream = fs.createReadStream(path.join(generatedTypesDir, index));
        const typesInvalidLines = readline.createInterface({
            input: typesIndexFileReadStream,
            crlfDelay: Infinity,
        });
        const newTypeIndexFileLines = [];
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
        fs.writeFileSync(
            path.join(generatedTypesDir, index),
            newTypeIndexFileLines.join('\n'),
            'utf8',
        );
        typesIndexFileReadStream.close();
        fs.writeFileSync(path.join(generatedEventsDir, index), needMoveLines.join('\n'), 'utf8');
    }
};

/**
 * Fix event file imports after moving to events folder.
 */
const fixEventFiles = (filePath: string): void => {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes("from '.'")) {
        content = content.replace("from '.'", "from '../types'");
        fs.writeFileSync(filePath, content, 'utf8');
    }
};

/**
 * Add @ts-nocheck to generated files with known Codama type inference issues.
 */
const addTsNoCheckToGeneratedTypes = (generatedSDKDir: string): void => {
    const typesDir = path.join(generatedSDKDir, 'types');
    if (!fs.existsSync(typesDir)) return;
    for (const file of fs.readdirSync(typesDir)) {
        if (!file.endsWith('.ts')) continue;
        const filePath = path.join(typesDir, file);
        let content = fs.readFileSync(filePath, 'utf8');
        if (content.includes('__kind: kind, fields') && !content.includes('@ts-nocheck')) {
            content = '// @ts-nocheck\n' + content;
            fs.writeFileSync(filePath, content, 'utf8');
        }
    }
};

async function generateTypeScriptSDK(programName: string, idlPath: string): Promise<void> {
    const generatedSDKDir = path.join(process.cwd(), 'build', programName);
    const anchorIdl = transformEventsToTypes(idlPath);
    // The build writes the compiled program ID into the IDL; the SDK takes it from there.
    if (!(anchorIdl as { address?: string }).address) throw new Error(`${idlPath} has no address`);
    console.log(`Generating TypeScript SDK: ${idlPath} → ${generatedSDKDir}`);
    const codama = createFromRoot(rootNodeFromAnchor(anchorIdl));
    await codama.accept(renderJavaScriptUmiVisitor(generatedSDKDir));
    await moveGenEventFiles(generatedSDKDir, anchorIdl.events ?? []);
    addTsNoCheckToGeneratedTypes(generatedSDKDir);
}

const ensureIdl = (programName: string, altPaths?: string[]): string => {
    const buildIdl = path.join(process.cwd(), 'build', `${programName}.json`);
    if (fs.existsSync(buildIdl)) return buildIdl;
    for (const alt of altPaths ?? []) {
        if (fs.existsSync(alt)) return alt;
    }
    return '';
};

const PROGRAMS: { name: string; altPaths?: string[] }[] = [
    { name: 'console_oft' },
    { name: 'example_composer' },
    // Built by token-manager-solana-contracts, copied here by `artifacts:copy`; tests drive its
    // ACL setup.
    {
        name: 'token_manager',
        altPaths: ['artifacts/token_manager.json'],
    },
    // Built by pubkey-policy-hook-solana-contracts, copied here by `artifacts:copy`; tests bind it
    // as the mint's hook.
    {
        name: 'pubkey_policy_hook',
        altPaths: ['artifacts/pubkey_policy_hook.json'],
    },
    // Built by pubkey-policy-solana-contracts, copied here by `artifacts:copy`.
    {
        name: 'pubkey_policy',
        altPaths: ['artifacts/pubkey_policy.json'],
    },
];

const main = async (): Promise<void> => {
    for (const { name, altPaths } of PROGRAMS) {
        const idlPath = ensureIdl(name, altPaths);
        if (idlPath) {
            await generateTypeScriptSDK(name, idlPath);
        } else {
            console.warn(`Skipping ${name}: no IDL found at build/${name}.json`);
        }
    }
};

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});
