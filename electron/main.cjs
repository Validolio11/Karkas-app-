const {
  app, BrowserWindow, ipcMain, Menu, shell, protocol, net, Tray,
  nativeImage, screen, Notification, safeStorage, dialog, session,
} = require('electron');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { beginBrowserGoogleLogin } = require('./browser-auth.cjs');
const { createDesktopStorage } = require('./storage.cjs');
const { createSecretStore } = require('./secrets.cjs');

const APP_SCHEME = 'karkas';
const LEGACY_PORT = 14141;
const MAX_IPC_BYTES = 30 * 1024 * 1024;
const isDevelopment = process.env.NODE_ENV === 'development' || !app.isPackaged;

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

function appIconPath() {
  if (process.platform === 'win32') {
    const ico = app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : path.join(__dirname, '../build/icon.ico');
    if (fs.existsSync(ico)) return ico;
  }
  const png = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '../build/icon.png');
  if (fs.existsSync(png)) return png;
  return path.join(__dirname, '../public/icon.png');
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
  let icon = nativeImage.createFromPath(appIconPath());
  if (!icon.isEmpty()) icon = icon.resize({ width: 16, height: 16 });
  tray = new Tray(icon);
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

function downloadFile(fileUrl, destination) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(fileUrl);
    if (!['https:', 'http:'].includes(parsed.protocol)) return reject(new Error('Unsupported download protocol'));
    const transport = parsed.protocol === 'https:' ? https : http;
    const request = transport.get(parsed, { headers: { 'User-Agent': 'Karkas-App' } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        return downloadFile(new URL(response.headers.location, parsed).toString(), destination).then(resolve, reject);
      }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error(`Installer download failed: HTTP ${response.statusCode}`)); }
      const stream = fs.createWriteStream(destination, { flags: 'wx' });
      response.pipe(stream);
      stream.on('finish', () => stream.close(() => resolve(destination)));
      stream.on('error', (error) => { fs.unlink(destination, () => {}); reject(error); });
    });
    request.on('error', reject);
  });
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
      error.code = 'AI_KEY_REJECTED';
      throw error;
    }
    await secrets.setGeminiApiKey(apiKey);
    return { models: Array.isArray(response.body.models) ? response.body.models : [] };
  });
  handle('karkas:ai:clear-key', async () => { await secrets.clearGeminiApiKey(); });
  handle('karkas:ai:assist', (input) => invokeService('assist', input || {}, true));
  handle('karkas:ai:breakdown', (input) => invokeService('breakdown', input || {}, true));
  handle('karkas:ai:recommendations', (input) => invokeService('recommendations', input || {}, true));
  handle('karkas:ai:transcribe-audio', (input) => invokeService('transcribeAudio', input || {}, true));
  handle('karkas:updates:check', () => invokeService('checkUpdate'));
  handle('karkas:updates:install', async ({ url, fileName }) => {
    if (typeof url !== 'string') throw new Error('Missing download URL');
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Unsupported download URL');
    const safeName = path.basename(typeof fileName === 'string' && fileName ? fileName : `Karkas-Setup-${Date.now()}.exe`);
    const destination = path.join(app.getPath('temp') || os.tmpdir(), `${Date.now()}-${safeName}`);
    await downloadFile(url, destination);
    const installer = spawn(destination, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true });
    installer.unref();
    isQuitting = true;
    setTimeout(() => app.quit(), 500);
  });

  handle('karkas:system:open-external', async ({ url }) => {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Unsupported external URL');
    await shell.openExternal(parsed.toString());
  });
  handle('karkas:system:notify', ({ title, body }) => {
    if (!Notification.isSupported()) throw new Error('System notifications are unavailable');
    new Notification({ title: String(title).slice(0, 120), body: String(body).slice(0, 1000), icon: appIconPath() }).show();
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
    backgroundColor: '#09090b', icon: appIconPath(), frame: false, autoHideMenuBar: true, title: 'Karkas',
    webPreferences: { zoomFactor: 1, nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
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
  mainWindow.on('closed', () => { mainWindow = null; });
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
app.on('before-quit', () => { isQuitting = true; loginController?.abort(); });
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
