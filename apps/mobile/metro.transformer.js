const upstreamTransformer = require('@expo/metro-config/babel-transformer');

module.exports.transform = async ({ src, filename, options }) => {
  // Handle .md files - return them as plain text strings
  if (filename.endsWith('.md')) {
    return upstreamTransformer.transform({
      src: `module.exports = ${JSON.stringify(src)};`,
      filename,
      options,
    });
  }

  // For everything else, use the default transformer
  return upstreamTransformer.transform({ src, filename, options });
};
