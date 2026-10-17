// TypeScript 7 ships no JS compiler API until 7.1: `require('typescript')` only
// returns the version. These tools drive the compiler in-process, so they get
// the TS 6 API under the `typescript` name as a real dependency.
//
// It has to replace their `typescript` peer: a peer would resolve to the
// workspace's TS 7, and packageExtensions and overrides don't change peer
// resolution. Drop each entry once the tool supports the TS 7.1 API.
//
// Other code still on the TS 6 API (grep `typescript6` to find it all):
// - ts-node (hardhat configs, blueprint builds, and jest loading jest.config.ts)
//   via TS_NODE_COMPILER, since it parses tsconfig with `typescript` before
//   reading a tsconfig override
// - ts-jest via its `compiler` option too: the entry below covers its own
//   `require('typescript')`, the option covers the compiler it loads per package
// - our own AST scripts, which import `@typescript/typescript6` directly
// - the legacy Create React App truesight, via `catalog:typescript6`
//
// Docker builds install from `turbo prune` output, which leaves this file out,
// so each one copies it in next to the pruned lockfile.
//
// Symptoms: a tool on TS 7 fails with "Cannot read properties of undefined
// (reading 'fileExists')" (or 'readFile'); an install without this file fails
// with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH on "pnpmfileChecksum".
const TYPESCRIPT_6 = 'npm:@typescript/typescript6@^6.0.2';

const needsTypeScript6Api = [
    /^@typescript-eslint\//,
    /^typescript-eslint$/,
    /^ts-api-utils$/,
    /^ts-jest$/,
    /^@hey-api\/openapi-ts$/,
];

const readPackage = (pkg) => {
    if (needsTypeScript6Api.some((pattern) => pattern.test(pkg.name))) {
        delete pkg.peerDependencies?.typescript;
        delete pkg.peerDependenciesMeta?.typescript;
        pkg.dependencies = { ...pkg.dependencies, typescript: TYPESCRIPT_6 };
    }
    return pkg;
};

module.exports = { hooks: { readPackage } };
