import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const dirCache = new Map<string, Promise<string | undefined>>();

export const writeFileAndCreateDirsCached = async (path: string, data: string) => {
    const dir = dirname(path);
    const ensureDir = () => {
        const cached = dirCache.get(dir);
        if (cached) return cached;

        const created = mkdir(dir, { recursive: true }).catch((err) => {
            dirCache.delete(dir);
            throw err;
        });
        dirCache.set(dir, created);
        return created;
    };

    try {
        await ensureDir();
        await writeFile(path, data, { encoding: 'utf-8' });
    } catch (err: any) {
        if (err?.code !== 'ENOENT') {
            throw err;
        }

        dirCache.delete(dir);
        await ensureDir();
        await writeFile(path, data, { encoding: 'utf-8' });
    }
};

export async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch (err: any) {
        return err.code !== 'ENOENT' ? true : false;
    }
}
