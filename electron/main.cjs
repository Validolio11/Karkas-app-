const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

let localServer = null;
const LOCAL_PORT = 14141;

function startLocalServer() {
  if (localServer) return;

  localServer = http.createServer((req, res) => {
    const decodedUrl = decodeURIComponent(req.url.split('?')[0]);
    let filePath = path.join(__dirname, '../dist', decodedUrl === '/' ? 'index.html' : decodedUrl);

    fs.readFile(filePath, (err, data) => {
      if (err) {
        fs.readFile(path.join(__dirname, '../dist/index.html'), (errIndex, dataIndex) => {
          if (errIndex) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(dataIndex);
        });
        return;
      }

      let contentType = 'text/html; charset=utf-8';
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.js') contentType = 'application/javascript; charset=utf-8';
      else if (ext === '.css') contentType = 'text/css; charset=utf-8';
      else if (ext === '.json') contentType = 'application/json; charset=utf-8';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.svg') contentType = 'image/svg+xml; charset=utf-8';
      else if (ext === '.ico') contentType = 'image/x-icon';

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });

  localServer.listen(LOCAL_PORT, '127.0.0.1', () => {
    console.log(`Local static server for production running on http://127.0.0.1:${LOCAL_PORT}`);
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    backgroundColor: '#09090b',
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    autoHideMenuBar: true,
    title: 'Karkas',
  });

  // Ensure popups (e.g. Google OAuth sign-in) are allowed in Electron
  mainWindow.webContents.setWindowOpenHandler((details) => {
    return { 
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: {
          // Inherit preload or keep standard
          contextIsolation: true,
          nodeIntegration: false,
        }
      }
    };
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

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    startLocalServer();
    mainWindow.loadURL(`http://localhost:${LOCAL_PORT}`);
  }
}

app.whenReady().then(() => {
  // Set custom user agent globally to prevent Google OAuth 403 "disallowed_useragent" error
  session.defaultSession.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
