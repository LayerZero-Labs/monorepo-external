import * as fs from 'node:fs';
import { dirname, join, resolve } from 'path';

export const pkgToFolderName = (fullPkgName: string): string => {
    return fullPkgName.replace(/^@/, '').replace(/\//g, '-');
};

export const ensureDirExists = async (dir: string) => {
    await fs.promises.mkdir(dir, { recursive: true });
};

export const ensureFileExists = async (filePath: string) => {
    if (await fileExists(filePath)) {
        return;
    }
    await ensureDirExists(dirname(filePath));
    await fs.promises.writeFile(filePath, '', 'utf-8');
};

const resolvePkgRoot = (
    resolvePath: (relativePathWithinPackage: string) => string,
    pkg: string,
): string => {
    // Use package.json as a stable anchor to the package root
    const pkgJsonPath = resolvePath(`${pkg}/package.json`);
    return dirname(pkgJsonPath);
};

export const copyHardhatCompilationArtifact = async ({
    resolvePath,
    rootPath,
    fromPkg,
    relativeArtifactPath,
    destRelativePath,
}: {
    resolvePath: (relativePathWithinPackage: string) => string;
    rootPath: string;
    fromPkg: string;
    relativeArtifactPath: string;
    destRelativePath: string;
}) => {
    const srcRoot = resolvePkgRoot(resolvePath, fromPkg);
    const src = join(srcRoot, relativeArtifactPath);
    const dest = join(rootPath, destRelativePath);
    await ensureDirExists(dirname(dest));
    await fs.promises.copyFile(src, dest);
    console.log(`Copied hardhat compilation artifact -> ${src} -> ${dest}`);
};

export const dirExists = async (path: string): Promise<boolean> => {
    try {
        const s = await fs.promises.stat(path);
        return s.isDirectory();
    } catch {
        return false;
    }
};

export const fileExists = async (filePath: string): Promise<boolean> => {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch {
        return false;
    }
};

export const makeReExportFile = async (
    folderName: string,
    names: string[],
    fileName: string = 'index.ts',
) => {
    const mapped = names
        .map(function (name) {
            return `export * from './${name}'`;
        })
        .sort();

    mapped.push('');

    await fs.promises.writeFile(resolve(folderName, fileName), mapped.join('\n'), 'utf-8');
};

const loadHardhatBuildInfo = async ({
    resolvePath,
    pkgName,
    contractName,
    artifactsDirName,
}: {
    resolvePath: (relativePathWithinPackage: string) => string;
    pkgName: string;
    contractName: string;
    artifactsDirName: string;
}): Promise<
    | {
          contractSourcePath: string;
          solcLongVersion: string;
          input: any;
          filePath: string;
          solcVersion?: string;
          zksolcVersion?: string;
      }
    | undefined
> => {
    const pkgJsonPath = resolvePath(`${pkgName}/package.json`);
    const rootPath = dirname(pkgJsonPath);
    const buildInfoDir = join(rootPath, artifactsDirName, 'build-info');
    if (!(await dirExists(buildInfoDir))) return undefined;

    const files = await fs.promises.readdir(buildInfoDir);
    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePath = join(buildInfoDir, file);
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const buildInfo = JSON.parse(content);

        if (buildInfo.input?.sources && buildInfo.solcLongVersion) {
            const sourceFiles = Object.keys(buildInfo.input.sources);
            const contractSourcePath = sourceFiles.find((sourcePath) =>
                sourcePath.endsWith(`/${contractName}.sol`),
            );
            if (contractSourcePath) {
                console.log(`Found build info for ${contractName} in ${filePath}`);

                // Try to extract zk-specific version info if available
                let solcVersion: string | undefined;
                let zksolcVersion: string | undefined;

                if (buildInfo.output?.contracts) {
                    // Find the contract path that ends with the contract file name
                    const contractPaths = Object.keys(buildInfo.output.contracts);
                    const contractPath = contractPaths.find((path) =>
                        path.endsWith(`/${contractName}.sol`),
                    );

                    if (contractPath) {
                        const contractData =
                            buildInfo.output.contracts[contractPath]?.[contractName];
                        if (contractData) {
                            solcVersion = contractData.metadata?.solc_version;
                            zksolcVersion = contractData.metadata?.zk_version;
                        }
                    }
                }

                return {
                    contractSourcePath,
                    solcLongVersion: buildInfo.solcLongVersion,
                    input: buildInfo.input,
                    filePath,
                    ...(solcVersion && { solcVersion }),
                    ...(zksolcVersion && { zksolcVersion }),
                };
            }
        }
    }
    return undefined;
};

export const copyBuildInfo = async ({
    resolvePath,
    rootPath,
    artifactsDirName,
    pkgName,
    contractName,
}: {
    resolvePath: (relativePathWithinPackage: string) => string;
    rootPath: string;
    artifactsDirName: string;
    pkgName: string;
    contractName: string;
}) => {
    const buildInfo = await loadHardhatBuildInfo({
        resolvePath,
        pkgName,
        contractName,
        artifactsDirName,
    });
    if (!buildInfo) return;

    const pkgFolderName = pkgToFolderName(pkgName);
    const dest = join(rootPath, artifactsDirName, pkgFolderName, contractName, 'buildInfo.json');
    await ensureDirExists(dirname(dest));

    await fs.promises.writeFile(dest, JSON.stringify(buildInfo, null, 2));
    console.log(`Saved build info -> ${dest}`);
};
