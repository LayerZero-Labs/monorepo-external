import { promises as fs } from 'fs';
import { builtinModules } from 'module';
import path from 'path';
import ts from 'typescript';

const DECLARATION_FILE_PATTERN = /\.d\.[cm]?ts$/;

const toPackageName = (specifier: string): string | undefined => {
    if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
        return undefined;
    }
    const segments = specifier.split('/');
    const name = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
    return builtinModules.includes(name) ? undefined : name;
};

export const findDeclarationImports = async (
    packagePath: string,
): Promise<Map<string, string[]>> => {
    const distPath = path.join(packagePath, 'dist');
    const entries = await fs.readdir(distPath, { recursive: true }).catch(() => []);
    const imports = new Map<string, string[]>();

    for (const entry of entries) {
        if (!DECLARATION_FILE_PATTERN.test(entry)) {
            continue;
        }
        const filePath = path.join(distPath, entry);
        const { importedFiles } = ts.preProcessFile(await fs.readFile(filePath, 'utf-8'));
        for (const { fileName } of importedFiles) {
            const name = toPackageName(fileName);
            if (name) {
                imports.set(name, [...(imports.get(name) ?? []), filePath]);
            }
        }
    }

    return imports;
};
