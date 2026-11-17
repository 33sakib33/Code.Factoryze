const { access, rm } = require('node:fs/promises');
const { join } = require('node:path');

// A custom electronDist can retain this development shell. Electron prefers it over app.asar.
// Remove it from the output bundle before signing; leave the development runtime untouched.
module.exports = async context => {
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, context.packager.appInfo.productFilename + '.app', 'Contents', 'Resources')
    : join(context.appOutDir, 'resources');
  await access(join(resources, 'app.asar'));
  await rm(join(resources, 'default_app.asar'), { force: true });
};
