const { spawn } = require('node:child_process');

/** Hand off to NSIS: it owns relaunch after replacing the installed files. */
async function launchUpdateInstaller(destination, {
  spawnInstaller = spawn,
  quit,
  schedule = setTimeout,
} = {}) {
  if (typeof quit !== 'function') throw new Error('Missing application quit callback');
  const installer = spawnInstaller(destination, ['/S', '--updated', '--force-run'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  // spawn() can fail asynchronously (permissions, invalid exe, missing file).
  // Keep the current app open and propagate that failure through IPC.
  await new Promise((resolve, reject) => {
    installer.once('error', reject);
    installer.once('spawn', resolve);
  });
  installer.unref();
  // Allow the IPC acknowledgement to reach the renderer before exiting.
  schedule(quit, 500);
}

module.exports = { launchUpdateInstaller };
