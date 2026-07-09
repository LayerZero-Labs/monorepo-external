// pnpm resolution hooks.
//
// Several packages tie themselves to a single `@types/express` version, which
// pnpm then dedupes across the whole workspace. That breaks consumers on
// different Express majors: the legacy `metadata`/`transfer` services are on
// Express 4 while `native-entry` is on Express 5, and a handler typed against
// one major won't match an app typed against the other.
//
// - `@types/swagger-ui-express` declares `@types/express` as a regular
//   dependency (`"@types/express": "*"`), forcing a single version.
// - `@scalar/express-api-reference` imports `Request`/`Response` from `express`
//   but only carries `@types/express` as a devDependency, so consumers fall
//   back to the root-hoisted version.
//
// For each, ensure `@types/express` is an optional peer dependency so every
// consumer supplies its own, letting pnpm resolve the express types
// per-consumer instead of forcing a single version.
const EXPRESS_TYPES_CONSUMERS = new Set([
    '@types/swagger-ui-express',
    '@scalar/express-api-reference',
]);

function readPackage(pkg) {
    if (EXPRESS_TYPES_CONSUMERS.has(pkg.name)) {
        if (pkg.dependencies && pkg.dependencies['@types/express']) {
            delete pkg.dependencies['@types/express'];
        }
        pkg.peerDependencies = {
            ...pkg.peerDependencies,
            '@types/express': '*',
        };
        pkg.peerDependenciesMeta = {
            ...pkg.peerDependenciesMeta,
            '@types/express': { optional: true },
        };
    }
    return pkg;
}

module.exports = {
    hooks: {
        readPackage,
    },
};
