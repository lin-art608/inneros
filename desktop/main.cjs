const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { APP_URL, isAppUrl, isExternalUrl } = require('./policy.cjs');

const smoke = process.argv.includes('--smoke-test');
// 运行测试使用独立目录，避免接触真实账户与本地记录。
if (smoke) app.setPath('userData', path.join(app.getPath('temp'), `inneros-smoke-${process.pid}`));
else app.setPath('userData', path.join(app.getPath('appData'), 'InnerOS'));
app.setAppUserModelId('asia.inneros.desktop');
let mainWindow;
let recovering = false;
let smokeDone = false;

async function openExternal(url) {
  if (isExternalUrl(url)) await shell.openExternal(url).catch(() => {});
}

async function recover(message) {
  if (smoke || recovering || !mainWindow || mainWindow.isDestroyed()) return;
  recovering = true;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning', title: 'InnerOS', message,
    detail: '本机记录仍保存在应用数据目录。请检查网络后重试。',
    buttons: ['重试', '稍后再试'], defaultId: 0, cancelId: 1
  });
  recovering = false;
  if (response === 0 && !mainWindow.isDestroyed()) loadApp();
}

function loadApp() {
  mainWindow.loadURL(APP_URL).catch(() => recover('暂时无法打开 InnerOS'));
}

function finishSmoke(code, data) {
  if (smokeDone) return;
  smokeDone = true;
  const report = process.env.INNEROS_SMOKE_REPORT;
  if (report) fs.writeFileSync(report, JSON.stringify(data, null, 2));
  app.exit(code);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180, height: 820, minWidth: 760, minHeight: 560,
    title: 'InnerOS', backgroundColor: '#f7f5f0',
    icon: path.join(__dirname, 'icon.png'), show: !smoke,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false,
      partition: smoke ? 'persist:smoke' : 'persist:inneros'
    }
  });
  const contents = mainWindow.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  const guardNavigation = (event, url) => {
    if (!isAppUrl(url)) { event.preventDefault(); openExternal(url); }
  };
  contents.on('will-navigate', guardNavigation);
  contents.on('will-redirect', guardNavigation);
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      if (smoke) finishSmoke(1, { ok: false, errorCode: code });
      else recover('页面加载失败，请检查网络后重试');
    }
  });
  contents.on('render-process-gone', () => recover('页面意外停止，请重新加载'));
  contents.on('page-title-updated', event => { event.preventDefault(); mainWindow.setTitle('InnerOS'); });
  if (smoke) {
    setTimeout(() => finishSmoke(1, { ok: false, reason: '加载超时' }), 60000).unref();
    contents.once('did-finish-load', async () => {
      try {
        const result = await contents.executeJavaScript(`(async () => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('inneros_desktop_smoke', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('probe');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          await new Promise((resolve, reject) => {
            const tx = db.transaction('probe', 'readwrite');
            tx.objectStore('probe').put('ok', 'desktop');
            tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
          });
          db.close();
          return { title: document.title, version: typeof APP_VERSION === 'string' ? APP_VERSION : null,
            nodeExposed: typeof require !== 'undefined' || typeof process !== 'undefined',
            indexedDB: true, apiClient: typeof window.InnerOSApi !== 'undefined',
            origin: location.origin };
        })()`);
        const screenshot = process.env.INNEROS_SMOKE_SCREENSHOT;
        await contents.executeJavaScript('enterGuest()');
        await new Promise(resolve => setTimeout(resolve, 500));
        result.navigation = await contents.executeJavaScript(`(async () => {
          await navigate('library');
          const library = currentPage;
          await navigateToParent();
          return { library, parent: currentPage };
        })()`);
        if (screenshot) fs.writeFileSync(screenshot, (await contents.capturePage()).toPNG());
        const viewports = [];
        mainWindow.setMinimumSize(0, 0);
        for (const [width, height] of [[375, 812], [390, 844], [430, 932]]) {
          mainWindow.setContentSize(width, height);
          await new Promise(resolve => setTimeout(resolve, 200));
          viewports.push(await contents.executeJavaScript(`({ width: innerWidth, height: innerHeight,
            overflow: document.documentElement.scrollWidth > innerWidth })`));
        }
        const ok = !result.nodeExposed && result.apiClient && result.navigation.library === 'library'
          && result.navigation.parent === 'memory' && viewports.every(viewport => !viewport.overflow);
        finishSmoke(ok ? 0 : 1, { ok, ...result, viewports });
      } catch { finishSmoke(1, { ok: false, reason: '页面验证失败' }); }
    });
  }
  loadApp();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  });
  app.whenReady().then(() => {
    const appSession = session.fromPartition(smoke ? 'persist:smoke' : 'persist:inneros');
    // 仅允许应用同源写剪贴板，保留分享复制；设备权限默认拒绝。
    appSession.setPermissionRequestHandler((contents, permission, callback) =>
      callback(permission === 'clipboard-sanitized-write' && isAppUrl(contents.getURL())));
    appSession.setPermissionCheckHandler((_contents, permission, origin) =>
      permission === 'clipboard-sanitized-write' && isAppUrl(origin));
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '应用', submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: loadApp },
        { label: '在浏览器中打开', click: () => openExternal(APP_URL) },
        { type: 'separator' }, { label: '退出', role: 'quit' }
      ] },
      { label: '编辑', submenu: [
        { label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' },
        { type: 'separator' }, { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' }
      ] },
      { label: '显示', submenu: [
        { label: '放大', role: 'zoomIn' }, { label: '缩小', role: 'zoomOut' },
        { label: '恢复缩放', role: 'resetZoom' }, { label: '全屏', role: 'togglefullscreen' }
      ] },
      { label: '帮助', submenu: [
        { label: '关于 InnerOS', click: () => dialog.showMessageBox(mainWindow, {
          title: '关于 InnerOS', message: `InnerOS 桌面版 ${app.getVersion()}`,
          detail: '独立 Windows 应用，连接线上 InnerOS。\n登录同一账户后同步云端记录。\n网页内容随线上更新；桌面程序需下载新版升级。'
        }) }
      ] }
    ]));
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
