const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Add support for .md files as source (not assets)
config.resolver.sourceExts = [...config.resolver.sourceExts, 'md'];

// Use custom transformer to handle .md files
config.transformer = {
  ...config.transformer,
  babelTransformerPath: path.resolve(__dirname, 'metro.transformer.js'),
};

// Watch all files in the monorepo
config.watchFolders = [workspaceRoot];

// Let Metro know where to resolve packages
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
