const https = require('node:https');
const fs = require('node:fs');
const { createHash, timingSafeEqual } = require('node:crypto');
const { updateDownloadError } = require('./update-download.cjs');

const REPOSITORY = 'Validolio11/Karkas-app-';
const LATEST_RELEASE = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const trustError = () => updateDownloadError('UPDATE_DOWNLOAD_UNTRUSTED', 'The update package could not be verified');

function stableVersion(value) {
  if (typeof value !== 'string' || !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw trustError();
  const parts = value.replace(/^v/, '').split('.').map(Number);
  if (parts.some(part => !Number.isSafeInteger(part))) throw trustError();
  return parts;
}

function newerVersion(release, current) {
  const left = stableVersion(release), right = stableVersion(current);
  for (let i = 0; i < 3; i += 1) if (left[i] !== right[i]) return left[i] > right[i];
  return false;
}

function releaseAssetUrl(tag, name) {
  return `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}

function assetUrlValidator(initialUrl) {
  return (value) => {
    const url = value instanceof URL ? value : new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hash) throw trustError();
    // GitHub release assets currently redirect to these dedicated download hosts.
    if (url.href !== initialUrl && !['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname)) throw trustError();
  };
}

/** Read small metadata from a fixed authority; redirects remain inside the asset allowlist. */
async function readMetadata(initialUrl, { signal, validateUrl, limit = 1024 * 1024 }) {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timeout = setTimeout(() => controller.abort(updateDownloadError('UPDATE_DOWNLOAD_TIMEOUT', 'Update verification timed out')), 30_000);
  try {
    let url = new URL(initialUrl);
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      controller.signal.throwIfAborted();
      validateUrl(url);
      const result = await new Promise((resolve, reject) => {
        const request = https.get(url, { signal: controller.signal, headers: { 'User-Agent': 'Karkas-Updater', Accept: 'application/vnd.github+json' } }, response => {
          response.on('error', reject);
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            try { resolve({ redirect: new URL(response.headers.location, url) }); }
            catch { reject(trustError()); }
            response.destroy();
            return;
          }
          if (response.statusCode !== 200) { reject(trustError()); response.destroy(); return; }
          let size = 0;
          const chunks = [];
          response.on('aborted', () => reject(trustError()));
          response.on('data', chunk => {
            size += chunk.length;
            if (size > limit) { response.destroy(trustError()); return; }
            chunks.push(chunk);
          });
          response.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8') }));
        });
        request.on('error', reject);
      });
      if (!result.redirect) return result.text;
      url = result.redirect;
    }
    throw trustError();
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw trustError();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

function manifestValue(text, key) {
  // Accept electron-builder's scalar metadata, never arbitrary YAML structures.
  const matches = text.split(/\r?\n/).filter(line => line.startsWith(`${key}:`));
  if (matches.length !== 1) throw trustError();
  const value = matches[0].slice(key.length + 1).trim();
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

async function resolveTrustedUpdate({ url, fileName, currentVersion, signal }) {
  const metadata = await readMetadata(LATEST_RELEASE, { signal, validateUrl: candidate => { if (candidate.href !== LATEST_RELEASE) throw trustError(); } });
  let release;
  try { release = JSON.parse(metadata); } catch { throw trustError(); }
  if (!release || release.draft || release.prerelease || !newerVersion(release.tag_name, currentVersion) || !Array.isArray(release.assets)) throw trustError();
  const expectedName = `Karkas-Setup-${release.tag_name.replace(/^v/, '')}.exe`;
  const expectedUrl = releaseAssetUrl(release.tag_name, expectedName);
  const installer = release.assets.find(asset => asset?.name === expectedName && asset.browser_download_url === expectedUrl);
  const manifestUrl = releaseAssetUrl(release.tag_name, 'latest.yml');
  if (!installer || url !== expectedUrl || fileName !== expectedName || !Number.isSafeInteger(installer.size) || installer.size <= 0
    || !release.assets.some(asset => asset?.name === 'latest.yml' && asset.browser_download_url === manifestUrl)) throw trustError();
  const manifest = await readMetadata(manifestUrl, { signal, validateUrl: assetUrlValidator(manifestUrl) });
  const sha512 = manifestValue(manifest, 'sha512');
  if (manifestValue(manifest, 'version') !== release.tag_name.replace(/^v/, '') || manifestValue(manifest, 'path') !== expectedName
    || !/^[A-Za-z0-9+/]{86}==$/.test(sha512) || Buffer.from(sha512, 'base64').length !== 64) throw trustError();
  return { url: expectedUrl, fileName: expectedName, sha512, size: installer.size, validateUrl: assetUrlValidator(expectedUrl) };
}

async function verifyUpdateFile(filePath, { sha512, size, signal }) {
  signal?.throwIfAborted();
  const stat = await fs.promises.lstat(filePath);
  if (!stat.isFile() || stat.size !== size) throw trustError();
  const hash = createHash('sha512');
  const stream = fs.createReadStream(filePath, { signal });
  for await (const chunk of stream) hash.update(chunk);
  signal?.throwIfAborted();
  if (!timingSafeEqual(hash.digest(), Buffer.from(sha512, 'base64'))) throw trustError();
}

module.exports = { resolveTrustedUpdate, verifyUpdateFile };
