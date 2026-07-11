import { app, BrowserWindow, protocol, shell } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'
import { cleanupTemp } from './media'
import { stopAllWatchers, syncWatchers } from './automation'
import { registerUpdater } from './updater'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

// Lets the renderer play/show local files (clipfile://media/<encoded abs path>)
// with proper range-request support for video scrubbing.
protocol.registerSchemesAsPrivileged([
  {
    // No bypassCSP: the page CSP already whitelists clipfile: for img/media,
    // and NOT exempting it keeps script-src 'self' authoritative — a stray
    // <script src="clipfile://…"> stays blocked instead of running.
    scheme: 'clipfile',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
  }
])

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 640,
    show: false,
    backgroundColor: '#0a0c0a',
    autoHideMenuBar: true,
    title: 'ClipRename',
    // resources/ ships inside the packaged app (build/ does not — it's only
    // installer input), so this path works in dev AND in the installed app.
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      // sandbox stays off: Chromium's OS sandbox requires a CommonJS preload,
      // but electron-vite emits ours as ESM (index.mjs) for this "type":
      // "module" project — enabling it makes contextBridge silently no-op and
      // window.api never appears. Isolation still rests on contextIsolation +
      // nodeIntegration:false + the strict CSP + the navigation guard below.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // Open external links in the system browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Lock the top frame to the app's own document. Without this, a click on a
  // link built from untrusted data (AI descriptions, filenames) could navigate
  // the window to a remote page — which would then inherit the full window.api
  // IPC bridge with no app CSP. Any off-app URL opens in the system browser.
  const isAppUrl = (url: string): boolean => {
    if (url.startsWith('clipfile://')) return true
    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
      return url.startsWith(process.env['ELECTRON_RENDERER_URL'])
    }
    return url.startsWith('file://')
  }
  const guardNavigation = (e: Electron.Event, url: string): void => {
    if (isAppUrl(url)) return
    e.preventDefault()
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  }
  win.webContents.on('will-navigate', guardNavigation)
  win.webContents.on('will-redirect', guardNavigation)

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const prefix = 'clipfile://media/'
  // Serve local files straight from disk so the <video> element gets a fully
  // seekable stream (proper range support + correct mime type).
  protocol.registerFileProtocol('clipfile', (request, callback) => {
    try {
      const enc = request.url.startsWith(prefix) ? request.url.slice(prefix.length) : ''
      callback({ path: decodeURIComponent(enc) })
    } catch {
      callback({ path: '' })
    }
  })

  registerIpc()
  registerUpdater()
  createWindow()
  // Resume any enabled watch-folder automations from a previous session.
  syncWatchers()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  cleanupTemp()
  stopAllWatchers()
  if (process.platform !== 'darwin') app.quit()
})
