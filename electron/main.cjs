const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const { beginBrowserGoogleLogin } = require('./browser-auth.cjs');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// Completely disable and remove default Electron menu bar (File, Edit, View, Window)
Menu.setApplicationMenu(null);

let localServer = null;
const LOCAL_PORT = 14141;
let loginController = null;

ipcMain.handle('google-login-browser', async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const expectedOrigin = app.isPackaged ? `http://localhost:${LOCAL_PORT}` : 'http://localhost:3000';
  if (!window || event.senderFrame !== event.sender.mainFrame ||
      new URL(event.senderFrame.url).origin !== expectedOrigin) {
    return { success: false, error: 'Недозволене джерело запиту входу.' };
  }
  if (loginController) return { success: false, error: 'Вхід уже відкрито у браузері.' };
  const controller = new AbortController();
  loginController = controller;
  const cancel = () => controller.abort();
  window.once('closed', cancel);
  try {
    const credential = await beginBrowserGoogleLogin({
      openExternal: (url) => shell.openExternal(url),
      assetDir: path.join(__dirname, '../dist'),
      signal: controller.signal,
    });
    if (!window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
    return { success: true, ...credential };
  } catch {
    return { success: false, error: 'Вхід не завершено. Спробуйте ще раз і підтвердьте Google-акаунт у браузері.' };
  } finally {
    window.removeListener('closed', cancel);
    if (loginController === controller) loginController = null;
  }
});
app.on('before-quit', () => loginController?.abort());

async function startLocalServer() {
  if (localServer) return;
  process.env.NODE_ENV = 'production';
  const { startServer } = require('../dist/server.cjs');
  localServer = await startServer({
    port: LOCAL_PORT,
    host: '127.0.0.1',
    distPath: path.join(__dirname, '../dist'),
  });
}

// Helper to download a file following redirects (e.g. GitHub releases)
function downloadFile(fileUrl, destPath) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(fileUrl);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const request = protocol.get(fileUrl, { headers: { 'User-Agent': 'Karkas-App' } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Follow redirect
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        return reject(new Error(`Failed to download installer: HTTP ${response.statusCode}`));
      }

      const fileStream = fs.createWriteStream(destPath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close(() => resolve(destPath));
      });

      fileStream.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });

    request.on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    backgroundColor: '#09090b',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(__dirname, '../build/icon.png'),
    frame: false,
    webPreferences: {
      zoomFactor: 1.25,
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    autoHideMenuBar: true,
    title: 'Karkas',
  });

  mainWindow.removeMenu();

  // Handle external window links and popup requests without opening blank white windows
  mainWindow.webContents.setWindowOpenHandler((details) => {
    const url = details.url || '';
    // For all external URLs (github, releases, downloads, web links), open in external default browser
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  ipcMain.on('window-minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });

  ipcMain.on('window-maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.on('window-close', () => {
    app.quit();
  });

  ipcMain.on('open-external', (event, targetUrl) => {
    if (targetUrl && (targetUrl.startsWith('https://') || targetUrl.startsWith('http://'))) {
      shell.openExternal(targetUrl);
    }
  });

  // Zero-interaction automated update installer handler
  ipcMain.handle('download-and-install-update', async (event, { url, fileName }) => {
    try {
      if (!url) throw new Error('Missing download URL');
      const safeName = fileName || `Karkas-Setup-Update-${Date.now()}.exe`;
      const tempPath = path.join(app.getPath('temp') || os.tmpdir(), safeName);

      // Download file to temp storage
      await downloadFile(url, tempPath);

      // Execute installer silently with NSIS /S switch or direct launch
      const installerProcess = spawn(tempPath, ['/S'], {
        detached: true,
        stdio: 'ignore',
      });

      installerProcess.unref();

      // Gracefully exit current app instance so installer can update binaries immediately
      setTimeout(() => {
        app.quit();
      }, 800);

      return { success: true };
    } catch (err) {
      console.error('Auto update installation error:', err);
      // Fallback: try opening path directly with system shell
      try {
        if (url) shell.openExternal(url);
      } catch {}
      return { success: false, message: err.message || 'Update failed' };
    }
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadURL(`http://localhost:${LOCAL_PORT}`);
  }
}

app.whenReady().then(async () => {
  if (app.isPackaged && process.env.NODE_ENV !== 'development') await startLocalServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch(() => {
  require('electron').dialog.showErrorBox('KARKAS', 'Не вдалося запустити локальний сервер застосунку. Закрийте іншу копію KARKAS і спробуйте ще раз.');
  app.quit();
});

app.on('before-quit', () => localServer?.close());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
