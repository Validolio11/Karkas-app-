const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');

function updateDownloadError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** One deadline covers all redirects; failures close the file before removing it. */
async function downloadUpdateFile(fileUrl, destination, {
  signal,
  totalTimeoutMs = 10 * 60 * 1000,
  inactivityTimeoutMs = 30 * 1000,
  maxRedirects = 5,
} = {}) {
  const controller = new AbortController();
  let primaryFailure = null;
  const abortDownload = (error) => {
    // The first cancellation, deadline or stream failure owns the result.
    primaryFailure ||= error;
    controller.abort(primaryFailure);
  };
  const isStorageFailure = (error) => ['ENOSPC', 'EDQUOT', 'EACCES', 'EPERM'].includes(error?.code);
  const storageFailure = () => updateDownloadError('UPDATE_DOWNLOAD_STORAGE', 'Unable to save the update package');
  const cancelled = () => abortDownload(signal?.reason || updateDownloadError('UPDATE_DOWNLOAD_CANCELLED', 'Update download cancelled'));
  signal?.addEventListener('abort', cancelled, { once: true });
  if (signal?.aborted) cancelled();
  let request;
  let response;
  let ownsFile = false;
  let inactivityTimer;
  const totalTimer = setTimeout(() => abortDownload(updateDownloadError('UPDATE_DOWNLOAD_TIMEOUT', 'Update download timed out')), totalTimeoutMs);
  const touch = () => {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => abortDownload(updateDownloadError('UPDATE_DOWNLOAD_STALLED', 'Update download stopped responding')), inactivityTimeoutMs);
  };
  try {
    let currentUrl = new URL(fileUrl);
    for (let redirects = 0; ; redirects += 1) {
      controller.signal.throwIfAborted();
      if (!['https:', 'http:'].includes(currentUrl.protocol)) throw updateDownloadError('UPDATE_DOWNLOAD_FAILED', 'Unsupported download protocol');
      touch();
      response = await new Promise((resolve, reject) => {
        const transport = currentUrl.protocol === 'https:' ? https : http;
        request = transport.get(currentUrl, {
          headers: { 'User-Agent': 'Karkas-App' }, signal: controller.signal,
        }, incoming => {
          // Keep an early response failure handled until pipeline takes ownership.
          incoming.on('error', () => {});
          resolve(incoming);
        });
        request.on('error', reject);
      });
      controller.signal.throwIfAborted();
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        if (redirects >= maxRedirects) throw updateDownloadError('UPDATE_DOWNLOAD_REDIRECT_LIMIT', 'Too many update download redirects');
        currentUrl = new URL(response.headers.location, currentUrl);
        response.destroy();
        request.destroy();
        continue;
      }
      if (response.statusCode !== 200) throw updateDownloadError('UPDATE_DOWNLOAD_FAILED', `Installer download failed: HTTP ${response.statusCode}`);
      touch();
      response.on('data', touch);
      response.once('aborted', () => abortDownload(updateDownloadError('UPDATE_DOWNLOAD_INTERRUPTED', 'Update download was interrupted')));
      const stream = fs.createWriteStream(destination, { flags: 'wx' });
      stream.once('open', () => { ownsFile = true; });
      // Latch a disk failure before pipeline's error listener destroys the source.
      // That teardown may emit response "aborted" and reject as AbortError.
      stream.prependOnceListener('error', error => {
        if (isStorageFailure(error)) abortDownload(storageFailure());
      });
      // pipeline propagates response errors, premature close, disk errors and abort.
      await pipeline(response, stream, { signal: controller.signal });
      controller.signal.throwIfAborted();
      return destination;
    }
  } catch (error) {
    const failure = primaryFailure || (typeof error?.code === 'string' && error.code.startsWith('UPDATE_DOWNLOAD_')
      ? error : isStorageFailure(error) ? storageFailure()
        : controller.signal.aborted ? controller.signal.reason
          : updateDownloadError('UPDATE_DOWNLOAD_FAILED', 'Unable to download the update package'));
    request?.destroy();
    response?.destroy();
    if (ownsFile) await fs.promises.unlink(destination).catch(() => {});
    throw failure;
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(inactivityTimer);
    signal?.removeEventListener('abort', cancelled);
    request?.destroy();
    response?.destroy();
  }
}

module.exports = { downloadUpdateFile, updateDownloadError };
