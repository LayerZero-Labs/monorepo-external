#!/usr/bin/env node
import { watch } from 'chokidar';
import ignore from 'ignore';
import { exec, spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { getFullyQualifiedRepoRootPath } from '@layerzerolabs/common-node-utils';

const execAsync = promisify(exec);

// Watches a pnpm workspace:
// - package.json add/change -> pnpm -w --filter <pkg> install
// - package.json delete     -> pnpm -w install
// - .ts/.tsx change         -> pnpm -w --filter <pkg> run --if-present build

const log = (msg: string): void => {
    console.log(`[watch] ${msg}`);
};

interface Task {
    id: string; // `${packageName}::${action}`
    packageName: string;
    action: 'install' | 'build';
    command: string[];
    retryCount: number;
    lastAttemptTime: number;
    nextRetryDelay: number; // in milliseconds
    hash?: string; // Turbo input hash, calculated during execution
}

const main = async (): Promise<void> => {
    const workspaceRoot: string = await getFullyQualifiedRepoRootPath();

    log(`Workspace root: ${workspaceRoot}`);

    // Queue system for task management
    const pendingQueue = new Map<string, Task>();
    const runningQueue = new Map<string, Task>();
    const retryQueue = new Map<string, Task>();
    const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const lastSuccessfulTasks = new Map<string, string>(); // key: pkg::action, value: hash
    const nameCache: Map<string, string> = new Map(); // dir -> pkg name (helps when package.json gets deleted)

    /** Load .gitignore patterns for efficient filtering */
    const loadGitIgnore = async () => {
        const ig = ignore();
        const gitignorePath = path.join(workspaceRoot, '.gitignore');

        try {
            const gitignoreContent = await fs.readFile(gitignorePath, 'utf8');
            ig.add(gitignoreContent);
            log('Loaded .gitignore patterns');
        } catch (error: unknown) {
            // File doesn't exist or can't be read - that's okay
            if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') {
                log(`Warning: Failed to load .gitignore (${error.message})`);
            }
        }

        return ig;
    };

    const gitignore = await loadGitIgnore();

    /** It is possible to combine static patterns with gitignore patterns */
    const IGNORED: Array<string | ((filepath: string) => boolean)> = [
        // You can add static patterns here if you want to ignore specific files or directories
        // '**/node_modules/**',
        // Add gitignore matcher as a function to ignore files and directories that are ignored by git
        (filepath: string) => {
            const relativePath = path.relative(workspaceRoot, filepath);
            // ignore package doesn't accept empty paths
            if (!relativePath || relativePath === '.') return false;
            return gitignore.ignores(relativePath);
        },
    ];

    /** Load all workspace packages upfront for performance */
    interface PackageInfo {
        name: string;
        path: string;
        private?: boolean;
    }

    const loadWorkspacePackages = async (): Promise<Map<string, string>> => {
        try {
            const { stdout } = await execAsync('pnpm m ls --json', {
                cwd: workspaceRoot,
                maxBuffer: 10000000,
            });
            const packages: PackageInfo[] = JSON.parse(stdout);
            const packageCache = new Map<string, string>();

            for (const pkg of packages) {
                // Normalize the path to absolute
                const pkgPath = path.isAbsolute(pkg.path)
                    ? pkg.path
                    : path.join(workspaceRoot, pkg.path);
                packageCache.set(path.resolve(pkgPath), pkg.name);
            }

            log(`Loaded ${packageCache.size} workspace packages`);
            return packageCache;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            log(
                `Warning: Failed to load workspace packages (${message}), will use filesystem fallback`,
            );
            return new Map();
        }
    };

    const packageCache = await loadWorkspacePackages();

    // Cache for file -> nearest package directory lookups (performance optimization)
    // Pre-populate with known package directories for instant lookups
    const packageDirCache = new Map<string, string | null>();
    for (const pkgDir of packageCache.keys()) {
        packageDirCache.set(pkgDir, pkgDir);
    }

    /** Get Turbo hash for a package to detect if inputs have changed */
    const getTurboHash = async (packageName: string): Promise<string | undefined> => {
        try {
            const { stdout } = await execAsync(
                `pnpm turbo run build --dry=json --filter=${packageName}`,
                { cwd: workspaceRoot, maxBuffer: 10000000 },
            );
            const result = JSON.parse(stdout);
            // Filter to find the task for our specific package
            // Turbo returns all tasks in the dependency graph
            const task = result.tasks?.find((t: any) => t.package === packageName);
            if (task?.hash === undefined) {
                log(`No hash found for ${packageName}`);
            }
            return task?.hash;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            log(`Failed to get Turbo hash for ${packageName}: ${message}`);
            return undefined; // Fallback: proceed without hash
        }
    };

    /** ---- watchers and actions ---- **/

    const watchPkgJson = (): void => {
        const watcher = watch('**/package.json', {
            cwd: workspaceRoot,
            ignoreInitial: true,
            ignored: IGNORED,
            awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
        });

        watcher.on('add', (file: string) => handlePkgJson('add', abs(file)));
        watcher.on('change', (file: string) => handlePkgJson('change', abs(file)));
        watcher.on('unlink', (file: string) => handlePkgJson('unlink', abs(file)));
    };

    const watchTsFiles = (): void => {
        const watcher = watch(['**/*.ts', '**/*.tsx'], {
            cwd: workspaceRoot,
            ignoreInitial: true,
            ignored: IGNORED,
            awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
        });

        watcher.on('add', (file: string) => maybeBuild(abs(file)));
        watcher.on('change', (file: string) => maybeBuild(abs(file)));
    };

    const handlePkgJson = async (
        event: 'add' | 'change' | 'unlink',
        file: string,
    ): Promise<void> => {
        const dir = path.dirname(file);
        const { name, isRoot } = await getPackageInfo(dir);

        if (event === 'unlink') {
            // The package no longer exists. Refresh the workspace to update lockfile.
            log(`package.json deleted in ${rel(dir)} → pnpm -w install`);
        }

        if (event === 'unlink' || isRoot) {
            // Refresh the workspace to update lockfile.
            schedule('workspace', 'install', ['-w', 'install']);
            return;
        }

        // Cache name so we still know it if package.json is later deleted
        if (name) nameCache.set(dir, name);

        if (!name) {
            // Not a proper package — skip.
            log(`Ignoring ${rel(file)} (no package name).`);
            return;
        }

        log(`package.json ${event} in ${rel(dir)} → install ${name}`);
        schedule(name, 'install', ['-w', '--filter', name, 'install']);
    };

    const maybeBuild = async (file: string) => {
        const pkgDir = findNearestPackageDir(file);
        if (!pkgDir) return;

        const { name, isRoot } = await getPackageInfo(pkgDir);
        if (!name || isRoot) return; // don't rebuild root on every repo-level TS change

        log(`${rel(file)} changed → build ${name}`);
        // --if-present so packages without a build script don't fail
        schedule(name, 'build', ['--filter', name, 'run', '--if-present', 'build']);
    };

    /** Calculate exponential backoff delay with 10s cap */
    const calculateNextDelay = (retryCount: number): number => {
        const baseDelay = 100;
        const maxDelay = 10000;
        const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
        return delay;
    };

    /** Check if a task can run based on queue state and priority rules */
    const canRunTask = (task: Task): boolean => {
        // Check if package already has a running task
        for (const runningTask of runningQueue.values()) {
            if (runningTask.packageName === task.packageName) {
                return false;
            }
        }

        // If this is a build task, check if there's a pending or running install for the same package
        if (task.action === 'build') {
            // Check running queue for install
            for (const runningTask of runningQueue.values()) {
                if (
                    runningTask.packageName === task.packageName &&
                    runningTask.action === 'install'
                ) {
                    return false;
                }
            }
            // Check pending queue for install (higher priority)
            for (const pendingTask of pendingQueue.values()) {
                if (
                    pendingTask.packageName === task.packageName &&
                    pendingTask.action === 'install'
                ) {
                    return false;
                }
            }
        }

        return true;
    };

    /** Add a task to pending queue, removing from retry if it exists */
    const enqueueTask = (task: Task): void => {
        // Remove from retry queue if it exists
        if (retryQueue.has(task.id)) {
            log(`Removing ${task.id} from retry queue (new task enqueued)`);
            retryQueue.delete(task.id);
        }

        // Add to pending queue (will replace existing if same id)
        if (pendingQueue.has(task.id)) {
            log(`Task ${task.id} already in pending queue, not duplicating`);
            return;
        }

        log(`Enqueuing task: ${task.id}`);
        pendingQueue.set(task.id, task);
    };

    /** Spawn pnpm at workspace root */
    const runPnpm = (args: readonly string[]): Promise<void> => {
        return new Promise((resolve, reject) => {
            const cmd = 'pnpm';
            log(`[START] '${cmd} ${args.join(' ')}'`);
            const child = spawn(cmd, args as string[], {
                cwd: workspaceRoot,
                stdio: 'inherit',
                // shell: process.platform === 'win32' // better Windows compatibility
            });
            child.on('exit', (code: number | null) => {
                log(`[END] '${cmd} ${args.join(' ')}' exited with code ${code}`);
                if (code === 0) resolve();
                else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
            });
        });
    };

    /** Execute a task */
    const executeTask = async (task: Task): Promise<void> => {
        runningQueue.set(task.id, task);
        task.lastAttemptTime = Date.now();

        // Calculate hash for build tasks before execution
        if (task.action === 'build') {
            task.hash = await getTurboHash(task.packageName);

            // Early return if hash matches last successful build
            if (task.hash) {
                const lastHash = lastSuccessfulTasks.get(task.id);
                if (lastHash === task.hash) {
                    log(`Skipping ${task.id} - hash ${task.hash} matches last successful build`);
                    runningQueue.delete(task.id);
                    return;
                }
            }
        }

        try {
            await runPnpm(task.command);
            handleTaskSuccess(task);
        } catch (error: unknown) {
            handleTaskFailure(task, error);
        }
    };

    /** Handle successful task completion */
    const handleTaskSuccess = (task: Task): void => {
        runningQueue.delete(task.id);
        if (task.hash) {
            lastSuccessfulTasks.set(task.id, task.hash);
            log(`Task ${task.id} completed successfully (hash: ${task.hash})`);
        } else {
            log(`Task ${task.id} completed successfully`);
        }
    };

    /** Handle task failure - move to retry queue */
    const handleTaskFailure = (task: Task, error: unknown): void => {
        runningQueue.delete(task.id);
        const message = error instanceof Error ? error.message : String(error);
        log(`Task ${task.id} failed: ${message}`);

        // Update retry info
        task.lastAttemptTime = Date.now();
        task.retryCount++;
        task.nextRetryDelay = calculateNextDelay(task.retryCount);

        log(
            `Task ${task.id} moved to retry queue (attempt ${task.retryCount}, next retry in ${task.nextRetryDelay}ms)`,
        );
        retryQueue.set(task.id, task);
    };

    /** Process retry queue - move eligible tasks back to pending */
    const processRetryQueue = (): void => {
        const now = Date.now();
        for (const [id, task] of retryQueue.entries()) {
            const timeSinceLastAttempt = now - task.lastAttemptTime;
            if (timeSinceLastAttempt >= task.nextRetryDelay) {
                log(`Moving ${id} from retry to pending queue`);
                retryQueue.delete(id);
                pendingQueue.set(id, task);
            }
        }
    };

    /** Process pending queue - execute tasks that are eligible */
    const processQueue = async (): Promise<void> => {
        // Process installs first (priority)
        const installs: Task[] = [];
        const builds: Task[] = [];

        for (const task of pendingQueue.values()) {
            if (task.action === 'install') {
                installs.push(task);
            } else {
                builds.push(task);
            }
        }

        // Try to run installs first
        for (const task of installs) {
            if (canRunTask(task)) {
                pendingQueue.delete(task.id);
                await executeTask(task);
                return; // Only process one task per tick
            }
        }

        // Then try to run builds
        for (const task of builds) {
            if (canRunTask(task)) {
                pendingQueue.delete(task.id);
                await executeTask(task);
                return; // Only process one task per tick
            }
        }
    };

    /** Debounce per (package, action) so rapid changes coalesce */
    const schedule = (pkg: string, action: 'install' | 'build', command: string[]): void => {
        const key = `${pkg}::${action}`;
        const existingTimer = debounceTimers.get(key);
        if (existingTimer) clearTimeout(existingTimer);
        const timeoutHandle = setTimeout(() => {
            debounceTimers.delete(key);
            enqueueTask({
                id: key,
                packageName: pkg,
                action,
                command,
                retryCount: 0,
                lastAttemptTime: 0,
                nextRetryDelay: 100,
            });
        }, 250);
        debounceTimers.set(key, timeoutHandle);
    };

    /** Find the nearest package dir for a file by walking up to a package.json */
    const findNearestPackageDir = (file: string) => {
        const resolvedFile = path.resolve(file);
        const startDir = path.dirname(resolvedFile);

        // Walk up from the file's directory until we find a cached entry
        // Since we pre-populated packageDirCache with all package directories,
        // we'll quickly hit a known package root (or null if outside workspace)
        const dirsToCache: string[] = [];
        let currentDir = startDir;

        while (true) {
            // Check if this directory is already cached
            const cached = packageDirCache.get(currentDir);
            if (cached !== undefined) {
                // Found a cached entry - use it for all directories we traversed
                for (const dir of dirsToCache) {
                    packageDirCache.set(dir, cached);
                }
                return cached;
            }

            const parentDir = path.dirname(currentDir);
            // Stop if we've reached the workspace root or system root
            if (currentDir === workspaceRoot || parentDir === currentDir) {
                // At workspace root with no package found
                for (const dir of dirsToCache) {
                    packageDirCache.set(dir, null);
                }
                return null;
            }

            // Not cached yet, remember it and continue walking up
            dirsToCache.push(currentDir);
            currentDir = parentDir;
        }
    };

    const getPackageInfo = async (dir: string) => {
        const resolvedDir = path.resolve(dir);
        const isRoot = samePath(resolvedDir, workspaceRoot);

        // Check the package cache first (from pnpm m ls)
        const cachedName = packageCache.get(resolvedDir);
        if (cachedName) {
            return { name: cachedName, isRoot };
        }

        // Fall back to filesystem read (for newly added packages or cache miss)
        const packageJsonPath = path.join(resolvedDir, 'package.json');
        try {
            const raw = await fs.readFile(packageJsonPath, 'utf8');
            const data = JSON.parse(raw) as { name?: string };
            const name = data.name || null;

            // Update both caches for future lookups
            if (name) {
                packageCache.set(resolvedDir, name);
                // Also update packageDirCache so findNearestPackageDir can find this package
                packageDirCache.set(resolvedDir, resolvedDir);
                const newPackageRoot = resolvedDir + path.sep;
                // Update all child directories that were cached as null or pointing to wrong parent
                // This keeps the cache consistent when new packages are added
                for (const [cachedDir, cachedPkgDir] of packageDirCache.entries()) {
                    // Check if cachedDir is a child of this new package
                    if (cachedDir.startsWith(newPackageRoot)) {
                        // Check for remapping of packages
                        if (cachedPkgDir && cachedPkgDir !== cachedDir) {
                            console.log(
                                `Updating cached directory ${cachedDir} to point to ${resolvedDir}`,
                            );
                        }
                        // Update to point to this new package
                        packageDirCache.set(cachedDir, resolvedDir);
                    }
                }
            }

            return { name, isRoot };
        } catch {
            return { name: nameCache.get(resolvedDir), isRoot };
        }
    };

    /** utils */
    const abs = (p: string): string => {
        return path.resolve(workspaceRoot, p);
    };
    const rel = (p: string): string => {
        return path.relative(workspaceRoot, p);
    };
    const samePath = (a: string, b: string): boolean => {
        return path.resolve(a) === path.resolve(b);
    };

    /** ---- Queue Processing Loop ---- **/
    // Process queues every 100ms
    setInterval(async () => {
        if (runningQueue.size > 0) return;
        processRetryQueue();
        await processQueue();
    }, 100);

    /** ---- Watchers ---- **/
    watchPkgJson();
    watchTsFiles();
};

main().catch((error: unknown) => {
    console.error('[watch] Fatal error:', error);
    process.exit(1);
});
