import fs from 'fs';
import ignore from 'ignore';
import path from 'path';

// Gitignore utilities
let gitignoreInstance: ReturnType<typeof ignore> | null = null;
let rootDirectory: string | null = null;

const loadGitignore = async (rootDir: string): Promise<ReturnType<typeof ignore>> => {
    const ig = ignore();

    try {
        const gitignorePath = path.join(rootDir, '.gitignore');
        const content = await fs.promises.readFile(gitignorePath, 'utf-8');
        ig.add(content);
    } catch {
        // If .gitignore doesn't exist, add common patterns
        ig.add(['node_modules', 'dist', 'build', '.turbo', '.git', 'coverage', 'cdk.out', '.next']);
    }

    return ig;
};

export const findConfigsInDir = async (dir: string, rootDir?: string): Promise<string[]> => {
    // Initialize gitignore on first call
    if (gitignoreInstance === null && rootDir) {
        gitignoreInstance = await loadGitignore(rootDir);
        rootDirectory = rootDir;
    }

    let results: string[] = [];
    try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                // Check if directory should be ignored using relative path from root
                if (gitignoreInstance && rootDirectory) {
                    const relativePath = path.relative(rootDirectory, fullPath);
                    if (gitignoreInstance.ignores(relativePath)) continue;
                }

                // Recursively search subdirectories
                const subResults = await findConfigsInDir(fullPath, rootDirectory ?? undefined);
                results.push(...subResults.map((f) => path.join(entry.name, f)));
            } else if (entry.isFile()) {
                if (
                    entry.name.toLowerCase().includes('config') &&
                    (entry.name.endsWith('.json') || entry.name.endsWith('.ts'))
                ) {
                    results.push(entry.name);
                }
            }
        }
    } catch (error) {
        console.error(`Error reading directory ${dir}:`, error);
    }

    return results;
};
