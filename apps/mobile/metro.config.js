const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// The engine's source of truth is packages/core, but EAS uploads only this
// directory - so scripts/sync-data.mjs stages a copy into src/core and Metro
// resolves against that. Without it a cloud build cannot see the engine at all
// and dies in `expo export:embed`.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.extraNodeModules = {
  '@bulksift/core': path.resolve(projectRoot, 'src/core'),
};

// index.bin is a binary asset, not source.
config.resolver.assetExts = [...config.resolver.assetExts, 'bin'];

/**
 * Keep the dev-only self-test out of release bundles.
 *
 * `if (__DEV__)` guards the *execution*, but Metro still walks the require and
 * bundles what it finds - the 6.2 MB of test frames turned up in a release APK
 * as dead weight, 14% of its size. Resolving those modules to `empty` in a
 * production bundle drops them from the graph without the require failing to
 * resolve at build time.
 */
const DEV_ONLY = /[\\/]assets[\\/]dev[\\/]|[\\/]selfTest(\.tsx?)?$|^\.[\\/]selfTest$/;
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // context.dev is Metro's own flag and is set correctly by the Gradle bundle
  // task; NODE_ENV is not reliably 'production' there.
  const isDev = context.dev !== false || process.env.NODE_ENV === 'development';
  if (!isDev && DEV_ONLY.test(moduleName)) {
    return { type: 'empty' };
  }
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
