const fs = require('node:fs');
const path = require('node:path');

/** Keep the window on PNG while Windows loads every size from the tray ICO. */
function resolveIconPaths({
  isPackaged,
  resourcesPath,
  appRoot,
  platform = process.platform,
  existsSync = fs.existsSync,
}) {
  const pngCandidates = isPackaged
    ? [path.join(resourcesPath, 'icon.png'), path.join(appRoot, 'dist', 'icon.png')]
    : [path.join(appRoot, 'build', 'icon.png'), path.join(appRoot, 'public', 'icon.png'), path.join(appRoot, 'dist', 'icon.png')];
  const window = pngCandidates.find((candidate) => existsSync(candidate));
  if (!window) throw new Error(`Karkas application icon is missing: ${pngCandidates.join(', ')}`);

  const ico = isPackaged
    ? path.join(resourcesPath, 'icon.ico')
    : path.join(appRoot, 'build', 'icon.ico');
  return { window, tray: platform === 'win32' && existsSync(ico) ? ico : window };
}

module.exports = { resolveIconPaths };
