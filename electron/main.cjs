const {
  app, BrowserWindow, ipcMain, Menu, shell, protocol, net, Tray,
  nativeImage, screen, Notification, safeStorage, dialog, session,
} = require('electron');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const { launchUpdateInstaller } = require('./update-installer.cjs');
const { downloadUpdateFile, updateDownloadError } = require('./update-download.cjs');
const { beginBrowserGoogleLogin } = require('./browser-auth.cjs');
const { createDesktopStorage } = require('./storage.cjs');
const { createSecretStore } = require('./secrets.cjs');
const { resolveIconPaths } = require('./app-icons.cjs');

const APP_SCHEME = 'karkas';
const LEGACY_PORT = 14141;
const MAX_IPC_BYTES = 30 * 1024 * 1024;
const isDevelopment = process.env.NODE_ENV === 'development' || !app.isPackaged;

if (process.platform === 'win32') app.setAppUserModelId('com.karkas.app');

protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

Menu.setApplicationMenu(null);

let mainWindow = null;
let tray = null;
let storage = null;
let secrets = null;
let loginController = null;
let isQuitting = false;
let persistWindowTimer = null;
let updateInProgress = false;
let activeUpdate = null;
let approvedUpdateUnload = null;
let uiLanguage = 'uk';

const ok = (value) => ({ ok: true, value });
const fail = (error) => ({
  ok: false,
  error: {
    code: typeof error?.code === 'string' ? error.code : 'DESKTOP_ERROR',
    message: typeof error?.message === 'string' ? error.message : 'Desktop operation failed',
  },
});

function assertPayload(value) {
  let encoded;
  try { encoded = JSON.stringify(value); } catch { throw new Error('IPC payload must be JSON serializable'); }
  if (Buffer.byteLength(encoded || '', 'utf8') > MAX_IPC_BYTES) throw new Error('IPC payload is too large');
}

function isTrustedSender(event) {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow || owner !== mainWindow || event.senderFrame !== event.sender.mainFrame) return false;
  try {
    const url = new URL(event.senderFrame.url);
    if (isDevelopment) return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '3000';
    return url.protocol === `${APP_SCHEME}:` && url.hostname === 'app';
  } catch {
    return false;
  }
}

function handle(channel, operation) {
  ipcMain.handle(channel, async (event, payload) => {
    if (!isTrustedSender(event)) return fail(Object.assign(new Error('Недозволене джерело IPC-запиту'), { code: 'UNTRUSTED_SENDER' }));
    try {
      assertPayload(payload);
      return ok(await operation(payload, event));
    } catch (error) {
      console.error(`[${channel}]`, error);
      return fail(error);
    }
  });
}

function on(channel, operation) {
  ipcMain.on(channel, (event, payload) => {
    if (!isTrustedSender(event)) return;
    try { assertPayload(payload); operation(payload, event); } catch (error) { console.error(`[${channel}]`, error); }
  });
}

function appIcons() {
  return resolveIconPaths({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appRoot: path.resolve(__dirname, '..'),
  });
}

function appIconPath() {
  return appIcons().window;
}

function windowIcon() {
  const icon = nativeImage.createFromPath(appIconPath());
  if (icon.isEmpty()) throw new Error('Unable to decode the Karkas window icon');
  return icon;
}

function showAndFocusWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function sendCommand(command) {
  showAndFocusWindow();
  mainWindow?.webContents.send('karkas:command', command);
}

function quitApplication() {
  isQuitting = true;
  loginController?.abort();
  app.quit();
}

function confirmLeavingDrafts(window, forUpdate = false) {
  const isUk = uiLanguage === 'uk';
  try {
    showAndFocusWindow();
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning', title: 'Karkas',
      buttons: isUk ? ['Залишитися', 'Вийти без збереження'] : ['Stay', 'Leave without saving'],
      defaultId: 0, cancelId: 0, noLink: true,
      message: isUk ? 'Є незбережені чернетки або незавершене голосове введення.' : 'There are unsaved drafts or unfinished voice input.',
      detail: forUpdate
        ? (isUk ? 'Для оновлення Karkas закриється. Незбережені чернетки й незавершене голосове введення буде втрачено. «Залишитися» не перериває запис або розпізнавання. Завершіть голосове введення та збережіть або скопіюйте текст перед оновленням.' : 'Karkas must close for the update. Unsaved drafts and unfinished voice input will be lost. Stay keeps recording or transcription in progress. Finish voice input and save or copy the text before updating.')
        : (isUk ? 'Якщо вийти зараз, незбережені чернетки й незавершене голосове введення буде втрачено. «Залишитися» не перериває запис або розпізнавання. Завершіть голосове введення та збережіть або скопіюйте текст перед виходом.' : 'Leaving now will lose unsaved drafts and unfinished voice input. Stay keeps recording or transcription in progress. Finish voice input and save or copy the text before leaving.'),
    });
    if (choice === 1) return true;
  } catch (error) {
    console.error('Unable to confirm unsaved drafts', error);
  }
  isQuitting = false;
  approvedUpdateUnload = null;
  showAndFocusWindow();
  return false;
}

function getWindowState() {
  return { maximized: Boolean(mainWindow?.isMaximized()), visible: Boolean(mainWindow?.isVisible()) };
}

async function persistWindowState() {
  if (!mainWindow || mainWindow.isDestroyed() || !storage) return;
  const bounds = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  await storage.updatePreferences({ window: { bounds, maximized: mainWindow.isMaximized() } });
}

function queueWindowStateSave() {
  clearTimeout(persistWindowTimer);
  persistWindowTimer = setTimeout(() => persistWindowState().catch(console.error), 250);
}

function validSavedBounds(bounds) {
  if (!bounds || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(bounds[key]))) return null;
  if (bounds.width < 760 || bounds.height < 540) return null;
  const intersects = screen.getAllDisplays().some(({ workArea }) =>
    bounds.x < workArea.x + workArea.width && bounds.x + bounds.width > workArea.x &&
    bounds.y < workArea.y + workArea.height && bounds.y + bounds.height > workArea.y);
  return intersects ? bounds : null;
}

function createTray() {
  if (tray) return;
  // Pass ICO directly on Windows so the shell selects the matching DPI frame.
  tray = new Tray(appIcons().tray);
  tray.setToolTip('Karkas');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Відкрити Karkas', click: showAndFocusWindow },
    { type: 'separator' },
    { label: 'Нова задача', click: () => sendCommand('new-task') },
    { label: 'Налаштування', click: () => sendCommand('open-settings') },
    { type: 'separator' },
    { label: 'Вийти', click: quitApplication },
  ]));
  tray.on('click', showAndFocusWindow);
  tray.on('double-click', showAndFocusWindow);
}

function registerAppProtocol() {
  const distRoot = path.resolve(__dirname, '../dist');
  protocol.handle(APP_SCHEME, (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
      const decoded = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const requested = decoded || 'index.html';
      const resolved = path.resolve(distRoot, requested);
      const relative = path.relative(distRoot, resolved);
      const safePath = !relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(resolved)
        ? resolved
        : path.join(distRoot, 'index.html');
      return net.fetch(pathToFileURL(safePath).toString());
    } catch {
      return new Response('Bad request', { status: 400 });
    }
  });
}

async function collectLegacyLocalStorage() {
  if (!app.isPackaged || fs.existsSync(storage.paths.workspace)) return null;
  let migrationWindow;
  let interceptInstalled = false;
  try {
    interceptInstalled = protocol.interceptStringProtocol('http', (request, callback) => {
      try {
        const url = new URL(request.url);
        if (url.hostname === 'localhost' && url.port === String(LEGACY_PORT)) {
          callback({
            data: '<!doctype html><html><body>Moving Karkas data...</body></html>',
            mimeType: 'text/html',
            charset: 'utf-8',
          });
          return;
        }
      } catch { /* reject malformed migration requests below */ }
      callback({ error: -10 });
    });
    if (!interceptInstalled) throw new Error('Could not install the one-time legacy origin interceptor');
    migrationWindow = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    // The previous production origin was exactly localhost, so use that host to
    // access its localStorage. Chromium serves the navigation internally, so
    // production never opens the former localhost TCP listener.
    await migrationWindow.loadURL(`http://localhost:${LEGACY_PORT}`);
    const snapshot = await migrationWindow.webContents.executeJavaScript(`(() => {
      const allowed = /^(life_todo_|ps_todo_|karkas_|todo_app_lang)/;
      const result = {};
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && allowed.test(key)) result[key] = localStorage.getItem(key);
      }
      return result;
    })()`);
    if (Object.keys(snapshot).length === 0) return null;
    await secrets.importLegacyGeminiApiKey(snapshot.karkas_custom_api_key);
    const zoom = Number(snapshot.karkas_app_zoom_percent);
    const preferenceChanges = {};
    if (Number.isFinite(zoom) && zoom >= 75 && zoom <= 150) preferenceChanges.zoomPercent = zoom;
    for (const key of ['karkas_custom_ai_enabled', 'karkas_custom_model', 'karkas_available_models']) {
      if (snapshot[key] != null) preferenceChanges[key] = snapshot[key];
    }
    if (Object.keys(preferenceChanges).length) await storage.updatePreferences(preferenceChanges);
    // Commit the workspace last: its verified file marks the migration complete.
    await storage.importLegacySnapshot(snapshot);
    return snapshot;
  } catch (error) {
    console.error('Legacy localStorage migration failed:', error);
    const migrationError = new Error('Не вдалося безпечно перенести дані попередньої версії. Закрийте іншу копію Karkas і запустіть застосунок знову.');
    migrationError.code = 'LEGACY_MIGRATION_FAILED';
    throw migrationError;
  } finally {
    if (migrationWindow && !migrationWindow.isDestroyed()) migrationWindow.destroy();
    if (interceptInstalled) protocol.uninterceptProtocol('http');
  }
}

async function awaitUpdatePreparation(operation, signal, timeoutMs = 10000) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
      if (error) reject(error);
      else resolve(value);
    };
    const cancel = () => finish(signal.reason);
    const timeout = setTimeout(() => finish(updateDownloadError('UPDATE_PREPARATION_TIMEOUT', 'Update preparation timed out')), timeoutMs);
    signal.addEventListener('abort', cancel, { once: true });
    // A late result cannot resume an already cancelled handoff.
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return operation();
    }).then(value => finish(null, value), finish);
  });
}

async function confirmUpdateUnload(renderer, signal) {
  if (renderer.isDestroyed()) throw updateDownloadError('UPDATE_PREPARATION_FAILED', 'Update window is unavailable');
  const result = await awaitUpdatePreparation(() => renderer.executeJavaScript(`(() => {
    const event = new Event('beforeunload', { cancelable: true });
    const allowed = window.dispatchEvent(event);
    return { blocked: !allowed || event.defaultPrevented, lang: document.documentElement.lang };
  })()`), signal, 5000);
  signal.throwIfAborted();
  if (!result || typeof result.blocked !== 'boolean') throw updateDownloadError('UPDATE_PREPARATION_FAILED', 'Unable to verify unsaved drafts');
  if (result.lang === 'uk' || result.lang === 'en') uiLanguage = result.lang;
  if (result.blocked) {
    const window = BrowserWindow.fromWebContents(renderer);
    if (!window || !confirmLeavingDrafts(window, true)) throw updateDownloadError('UPDATE_UNSAVED_DRAFTS', 'Update postponed to preserve unsaved drafts');
    signal.throwIfAborted();
    // Only this approved handoff may skip the repeated native unload prompt.
    approvedUpdateUnload = renderer;
  }
}

async function invokeService(operation, body = {}, useStoredKey = false) {
  assertPayload(body);
  const requestBody = { ...body };
  if (useStoredKey && requestBody.customEnabled !== false) {
    if (!requestBody.customApiKey) {
      const storedKey = await secrets.getGeminiApiKey();
      if (storedKey) requestBody.customApiKey = storedKey;
    }
  }
  const { invokeDesktopApi } = require('../dist/server.cjs');
  return invokeDesktopApi(operation, requestBody);
}

function registerIpc() {
  on('karkas:window:minimize', () => mainWindow?.minimize());
  on('karkas:window:toggle-maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
  on('karkas:window:hide', () => mainWindow?.hide());
  handle('karkas:window:quit', () => { quitApplication(); });
  handle('karkas:window:get-state', getWindowState);
  on('karkas:system:ui-language', ({ lang }) => {
    if (lang === 'uk' || lang === 'en') uiLanguage = lang;
  });

  handle('karkas:workspace:load-account', ({ ownerId }) => storage.loadAccount(ownerId ?? null));
  handle('karkas:workspace:save-account', async ({ ownerId, record }) => { await storage.saveAccount(ownerId ?? null, record); });
  handle('karkas:workspace:get-active-owner', () => storage.getActiveOwner());
  handle('karkas:workspace:set-active-owner', async ({ ownerId }) => { await storage.setActiveOwner(ownerId ?? null); });
  handle('karkas:workspace:create-recovery', async ({ ownerId }) => { await storage.createRecoveryPoint(ownerId ?? null); });
  handle('karkas:workspace:stage-sync', ({ ownerId, workspace, base, operations }) => storage.stageSync(ownerId, { workspace, base, operations }));
  handle('karkas:workspace:claim-sync', ({ ownerId, bypassBackoff }) => storage.claimSync(ownerId, Boolean(bypassBackoff)));
  handle('karkas:workspace:mark-sync-failed', ({ ownerId, mutationId, message }) => storage.markSyncFailed(ownerId, mutationId, message));
  handle('karkas:workspace:ack-sync', ({ ownerId, mutationId, base, lastSyncTime }) =>
    storage.acknowledgeSync(ownerId, mutationId, { base, lastSyncTime }));
  handle('karkas:workspace:replace-with-cloud', ({ ownerId, workspace, lastSyncTime }) =>
    storage.replaceWithCloud(ownerId, workspace, lastSyncTime));
  handle('karkas:preferences:get', async () => await storage.loadPreferences() || {});
  handle('karkas:preferences:update', (changes) => storage.updatePreferences(changes || {}));

  handle('karkas:auth:google-login', async (_payload, event) => {
    if (loginController) throw new Error('Вхід уже відкрито у браузері.');
    const window = BrowserWindow.fromWebContents(event.sender);
    const controller = new AbortController();
    loginController = controller;
    const cancel = () => controller.abort();
    window.once('closed', cancel);
    try {
      const credential = await beginBrowserGoogleLogin({
        openExternal: (url) => shell.openExternal(url), assetDir: path.join(__dirname, '../dist'), signal: controller.signal,
      });
      showAndFocusWindow();
      return { success: true, ...credential };
    } finally {
      window.removeListener('closed', cancel);
      if (loginController === controller) loginController = null;
    }
  });

  handle('karkas:ai:has-key', () => secrets.hasGeminiApiKey());
  handle('karkas:ai:verify-key', async ({ apiKey }) => {
    if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 8192) throw new Error('Некоректний Gemini API key');
    const response = await invokeService('verifyKey', { apiKey });
    if (response.status < 200 || response.status >= 300 || !response.body?.success) {
      const error = new Error(response.body?.error || 'Не вдалося перевірити API key');
      error.code = response.body?.code || 'AI_KEY_REJECTED';
      throw error;
    }
    await secrets.setGeminiApiKey(apiKey);
    return { models: Array.isArray(response.body.models) ? response.body.models : [] };
  });
  handle('karkas:ai:clear-key', async () => { await secrets.clearGeminiApiKey(); });
  handle('karkas:ai:assist', (input) => invokeService('assist', input || {}, true));
  handle('karkas:ai:breakdown', (input) => invokeService('breakdown', input || {}, true));
  handle('karkas:ai:recommendations', (input) => invokeService('recommendations', input || {}, true));
  handle('karkas:ai:voice-token', (input) => invokeService('voiceToken', input || {}, true));
  handle('karkas:ai:transcribe-audio', (input) => invokeService('transcribeAudio', input || {}, true));
  handle('karkas:updates:check', () => invokeService('checkUpdate'));
  handle('karkas:updates:install', async ({ url, fileName, requestId }, event) => {
    if (updateInProgress) throw new Error('An update is already in progress');
    if (process.platform !== 'win32' || !app.isPackaged) throw new Error('Automatic installation requires the installed Windows app');
    if (typeof url !== 'string') throw new Error('Missing download URL');
    if (typeof requestId !== 'string' || !requestId || requestId.length > 128) throw new Error('Missing update request identifier');
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Unsupported download URL');
    const safeName = path.basename(typeof fileName === 'string' && fileName ? fileName : `Karkas-Setup-${Date.now()}.exe`);
    if (!safeName.toLowerCase().endsWith('.exe') || !parsed.pathname.toLowerCase().endsWith('.exe')) throw new Error('Missing Windows installer asset');
    const destination = path.join(app.getPath('temp') || os.tmpdir(), `${Date.now()}-${randomUUID()}-${safeName}`);
    const controller = new AbortController();
    let finish;
    const operation = { requestId, controller, phase: 'downloading', sender: event.sender, completion: new Promise(resolve => { finish = resolve; }) };
    const cancel = () => {
      if (operation.phase === 'downloading') controller.abort(updateDownloadError('UPDATE_DOWNLOAD_CANCELLED', 'Update download cancelled'));
    };
    const publishPhase = () => {
      if (!event.sender.isDestroyed()) event.sender.send('karkas:updates:state', { requestId, phase: operation.phase });
    };
    updateInProgress = true;
    activeUpdate = operation;
    event.sender.once('destroyed', cancel);
    let downloaded = false;
    let handedOff = false;
    try {
      publishPhase();
      await downloadUpdateFile(url, destination, { signal: controller.signal });
      downloaded = true;
      controller.signal.throwIfAborted();
      await awaitUpdatePreparation(persistWindowState, controller.signal);
      await confirmUpdateUnload(event.sender, controller.signal);
      controller.signal.throwIfAborted();
      // Lock cancellation synchronously before starting the installer process.
      operation.phase = 'installing';
      publishPhase();
      await launchUpdateInstaller(destination, { quit: quitApplication });
      handedOff = true;
    } catch (error) {
      if (approvedUpdateUnload === event.sender) approvedUpdateUnload = null;
      if (downloaded) await fs.promises.unlink(destination).catch(() => {});
      throw error;
    } finally {
      event.sender.removeListener('destroyed', cancel);
      if (!handedOff) updateInProgress = false;
      if (activeUpdate === operation) activeUpdate = null;
      finish();
    }
  });
  handle('karkas:updates:cancel-download', async ({ requestId }, event) => {
    const operation = activeUpdate;
    if (!operation || operation.requestId !== requestId || operation.sender !== event.sender) return { cancelled: false, phase: 'idle' };
    if (operation.phase !== 'downloading') return { cancelled: false, phase: 'installing' };
    operation.controller.abort(updateDownloadError('UPDATE_DOWNLOAD_CANCELLED', 'Update download cancelled'));
    // A retry becomes available only after streams and temporary files are closed.
    await operation.completion;
    return { cancelled: true, phase: 'idle' };
  });

  handle('karkas:system:open-external', async ({ url }) => {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Unsupported external URL');
    await shell.openExternal(parsed.toString());
  });
  handle('karkas:system:get-version', () => app.getVersion());
  handle('karkas:system:notify', async ({ title, body }) => {
    if (!Notification.isSupported()) throw new Error('System notifications are unavailable');
    const notification = new Notification({ title: String(title).slice(0, 120), body: String(body).slice(0, 1000), icon: appIconPath() });
    notification.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('System notification did not confirm delivery')), 5000);
      const shown = () => finish();
      const failed = (_event, error) => finish(new Error(error || 'System notification failed'));
      const finish = error => {
        clearTimeout(timeout);
        notification.removeListener('show', shown);
        notification.removeListener('failed', failed);
        if (error) reject(error); else resolve();
      };
      notification.once('show', shown);
      notification.once('failed', failed);
      try { notification.show(); } catch (error) { finish(error); }
    });
  });
  handle('karkas:system:get-startup', () => app.getLoginItemSettings().openAtLogin);
  handle('karkas:system:set-startup', async ({ enabled }) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: process.execPath });
    await storage.updatePreferences({ launchAtStartup: Boolean(enabled) });
    return app.getLoginItemSettings().openAtLogin;
  });
}

async function createWindow() {
  const preferences = await storage.loadPreferences() || {};
  const savedBounds = validSavedBounds(preferences.window?.bounds);
  mainWindow = new BrowserWindow({
    ...(savedBounds || { width: 1280, height: 850 }), minWidth: 760, minHeight: 540, show: false,
    backgroundColor: '#09090b', icon: windowIcon(), frame: false, autoHideMenuBar: true, title: 'Karkas',
    webPreferences: { zoomFactor: 1, backgroundThrottling: false, nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try { const parsed = new URL(url); if (['https:', 'http:'].includes(parsed.protocol)) shell.openExternal(parsed.toString()); } catch {}
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDevelopment ? /^http:\/\/(localhost|127\.0\.0\.1):3000(?:\/|$)/.test(url) : url.startsWith(`${APP_SCHEME}://app/`);
    if (!allowed) event.preventDefault();
  });
  const window = mainWindow;
  const renderer = window.webContents;
  renderer.on('will-prevent-unload', (event) => {
    if (approvedUpdateUnload === renderer) {
      approvedUpdateUnload = null;
      // Electron preventDefault here ignores the renderer guard and permits exit.
      event.preventDefault();
    } else if (confirmLeavingDrafts(window)) {
      event.preventDefault();
    }
  });
  const isMediaPermission = (permission) => {
    return permission === 'media' || permission === 'audio-capture' || permission === 'microphone';
  };
  mainWindow.webContents.session.setPermissionCheckHandler((_webContents, permission) => {
    return isMediaPermission(permission);
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (isMediaPermission(permission)) return callback(true);
    callback(false);
  });
  if (session.defaultSession) {
    session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
      return isMediaPermission(permission);
    });
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      if (isMediaPermission(permission)) return callback(true);
      callback(false);
    });
  }
  mainWindow.on('close', (event) => { if (!isQuitting) { event.preventDefault(); mainWindow.hide(); } });
  mainWindow.on('resize', queueWindowStateSave);
  mainWindow.on('move', queueWindowStateSave);
  mainWindow.on('maximize', () => { queueWindowStateSave(); mainWindow.webContents.send('karkas:window:state', getWindowState()); });
  mainWindow.on('unmaximize', () => { queueWindowStateSave(); mainWindow.webContents.send('karkas:window:state', getWindowState()); });
  mainWindow.on('closed', () => {
    if (approvedUpdateUnload === renderer) approvedUpdateUnload = null;
    mainWindow = null;
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!input.control || input.alt || input.meta || input.shift || input.type !== 'keyDown') return;
    if (input.key.toLowerCase() === 'q') { event.preventDefault(); quitApplication(); }
    if (input.key === ',') { event.preventDefault(); sendCommand('open-settings'); }
  });
  mainWindow.once('ready-to-show', () => {
    if (preferences.window?.maximized) mainWindow.maximize();
    mainWindow.show();
  });
  if (isDevelopment) await mainWindow.loadURL('http://localhost:3000');
  else await mainWindow.loadURL(`${APP_SCHEME}://app/index.html`);
}

app.on('second-instance', showAndFocusWindow);
app.on('before-quit', () => {
  isQuitting = true;
  loginController?.abort();
  if (activeUpdate?.phase === 'downloading') activeUpdate.controller.abort(updateDownloadError('UPDATE_DOWNLOAD_CANCELLED', 'Update download cancelled'));
});
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  storage = createDesktopStorage({ userDataPath: app.getPath('userData') });
  secrets = createSecretStore({ userDataPath: app.getPath('userData'), safeStorage });
  await collectLegacyLocalStorage();
  registerAppProtocol();
  registerIpc();
  createTray();
  await createWindow();
  app.on('activate', () => mainWindow ? showAndFocusWindow() : createWindow().catch(console.error));
}).catch((error) => {
  console.error(error);
  dialog.showErrorBox('Karkas', 'Не вдалося запустити desktop-застосунок. Перезапустіть Karkas або перевірте журнал помилок.');
  quitApplication();
});
