import { promises as fs } from 'fs';
import path from 'path';
import ts from 'typescript';

interface PnpmPackageObject {
    name: string;
    path: string;
}

const getAllTsFiles = async (dir: string): Promise<string[]> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (
            entry.isDirectory() &&
            !entry.name.startsWith('node_modules') &&
            !entry.name.startsWith('dist') &&
            !entry.name.startsWith('cdk.out')
        ) {
            files.push(...(await getAllTsFiles(fullPath)));
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
            files.push(fullPath);
        }
    }

    return files;
};

const extractImportsUsingAST = (
    filePath: string,
    content: string,
    fromPackage: string,
): string[] => {
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

    const imports: string[] = [];
    const subpaths: string[] = [];

    function visit(node: any) {
        if (node.kind === ts.SyntaxKind.ImportDeclaration) {
            const moduleSpecifier = node.moduleSpecifier.text;

            if (moduleSpecifier === fromPackage || moduleSpecifier.startsWith(`${fromPackage}/`)) {
                if (moduleSpecifier.startsWith(`${fromPackage}/`)) {
                    subpaths.push(moduleSpecifier.substring(fromPackage.length + 1));
                }

                if (node.importClause) {
                    if (node.importClause.name) {
                        imports.push(node.importClause.name.text);
                    }

                    if (node.importClause.namedBindings) {
                        const bindings = node.importClause.namedBindings;

                        if (bindings.kind === ts.SyntaxKind.NamedImports) {
                            bindings.elements.forEach((element: any) => {
                                imports.push(element.name.text);
                            });
                        } else if (bindings.kind === ts.SyntaxKind.NamespaceImport) {
                            imports.push(`*`);
                        }
                    }
                }
            }
        } else if (node.kind === ts.SyntaxKind.CallExpression) {
            if (
                node.expression.kind === ts.SyntaxKind.PropertyAccessExpression &&
                node.expression.expression.kind === ts.SyntaxKind.Identifier &&
                node.expression.expression.text === 'require' &&
                node.expression.name.text === 'resolve' &&
                node.arguments.length > 0 &&
                node.arguments[0].kind === ts.SyntaxKind.StringLiteral
            ) {
                // Check for require.resolve('package') calls
                const moduleName = node.arguments[0].text;

                if (moduleName === fromPackage || moduleName.startsWith(`${fromPackage}/`)) {
                    imports.push(`require.resolve(${moduleName})`);
                    if (moduleName.startsWith(`${fromPackage}/`)) {
                        subpaths.push(moduleName.substring(fromPackage.length + 1));
                    }
                }
            }
        }

        ts.forEachChild(node, visit);
    }

    visit(sourceFile);

    if (subpaths.length > 0) {
        console.log(`${filePath}: imports from ${fromPackage} subpaths: ${subpaths.join(', ')}`);
    }

    return imports;
};

export const extractPackageImports = async (
    packageName: string,
    importedPackage: string,
    pnpmLsObject: { [key: string]: PnpmPackageObject },
) => {
    const packagePath = path.dirname(path.join(pnpmLsObject[packageName].path, 'package.json'));
    try {
        const tsFiles = await getAllTsFiles(packagePath);
        const importsByFile: Record<string, string[]> = {};
        let allImports: Set<string> = new Set();

        for (const file of tsFiles) {
            const content = await fs.readFile(file, 'utf-8');
            const imports = extractImportsUsingAST(file, content, importedPackage);

            if (imports.length > 0) {
                const relativePath = path.relative(packagePath, file);
                importsByFile[relativePath] = imports;
                imports.forEach((imp) => allImports.add(imp));
            }
        }

        console.log(`\nImports from '${importedPackage}' in package '${packageName}':`);
        console.log('---------------------------------------------------');

        if (Object.keys(importsByFile).length === 0) {
            console.log(`No imports found from ${importedPackage}`);
            return [];
        }

        for (const [file, imports] of Object.entries(importsByFile)) {
            console.log(`${file}: ${imports.join(', ')}`);
        }

        console.log(`\nAll unique imports: ${[...allImports].join(', ')}`);
        return [...allImports];
    } catch (error) {
        console.error(`Error extracting imports from ${packageName}:`, error);
        return [];
    }
};
