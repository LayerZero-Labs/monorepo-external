import fs from 'fs';
import type { GitAuth } from 'isomorphic-git';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import os from 'os';
import path from 'path';

import type { PnpmPackageObject } from './types';

export const exportToGithub = async (
    packageNames: string[],
    pnpmLsObjects: { [key: string]: PnpmPackageObject },
    gitOptions: {
        remote: string;
        commitMessage: string;
        githubToken: string;
        branch: string;
        author: { name: string; email: string };
    },
) => {
    const tmpDir = os.tmpdir();
    const repoDir = path.join(tmpDir, 'monorepo');

    try {
        await git.clone({
            fs,
            http,
            url: gitOptions.remote,
            dir: repoDir,
            onAuth: (_url: string, auth: GitAuth) => {
                auth.username = gitOptions.githubToken;
                return auth;
            },
        });

        for (const packageName of packageNames) {
            const packageJsonPath = pnpmLsObjects[packageName].path;
            const relativePackageDirName = path.join(
                path.relative(pnpmLsObjects['root'].path, packageJsonPath),
            );

            await fs.promises.cp(packageJsonPath, path.join(repoDir, relativePackageDirName), {
                recursive: true,
                filter: (src) => {
                    console.log(src);
                    return !git.isIgnored({
                        fs,
                        dir: pnpmLsObjects['root'].path,
                        filepath: src,
                    });
                },
            });

            // add all of the changed files
            await git.add({
                fs,
                dir: repoDir,
                filepath: relativePackageDirName,
            });
        }

        // commit the changes
        await git.commit({
            fs,
            dir: repoDir,
            message: gitOptions.commitMessage,
            author: {
                name: gitOptions.author.name,
                email: gitOptions.author.email,
            },
        });

        // push the changes
        await git.push({
            fs,
            http,
            dir: repoDir,
            url: gitOptions.remote,
            ref: gitOptions.branch,
            onAuth: (_url: string, auth: GitAuth) => {
                auth.username = gitOptions.githubToken;
                return auth;
            },
        });
    } catch (error) {
        console.error(error);
    } finally {
        // Clean up the temporary directory
        if (repoDir && fs.existsSync(repoDir)) {
            console.log(`Cleaning up temporary directory: ${repoDir}`);
            await fs.promises.rm(repoDir, { recursive: true, force: true });
        }
    }
};
