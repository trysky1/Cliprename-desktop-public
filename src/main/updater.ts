import { app, BrowserWindow, ipcMain, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { spawn } from 'child_process'
import { createWriteStream, promises as fs } from 'fs'
import path from 'path'
import { UpdateCheckResult } from '../shared/types'

// In-app updates, fed by the repo's GitHub Releases. One-click on BOTH OSes:
// - Windows: electron-updater's NSIS flow (download → silent install → relaunch);
//   works without a code-signing certificate.
// - macOS: Apple only lets SIGNED apps use the standard updater, so we do the
//   swap ourselves: download the release .zip (files our own process downloads
//   carry no quarantine flag, so Gatekeeper doesn't re-block), then on restart
//   a tiny helper script waits for the app to exit, replaces the .app bundle,
//   and relaunches it. If anything fails the old app is put back untouched.
const { autoUpdater } = electronUpdater
const REPO = 'trysky1/Cliprename-desktop-public'
const RELEASES_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`

let downloadStarted = false
let downloadReady = false
// macOS: the picked .zip asset for this CPU + where we downloaded it.
let macZipUrl: string | null = null
let macZipPath: string | null = null

function send(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

// "v0.1.2" vs "0.1.10" → is `a` newer than `b`?
function isNewer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

interface GithubAsset {
  name: string
  browser_download_url: string
}

type LatestRelease =
  | { ok: true; tag: string; notes: string; url: string; assets: GithubAsset[] }
  // Anything that isn't a network failure: private repo (404), rate limit
  // (403), or simply no release published yet.
  | { ok: false; reason: 'unavailable' }
  | { ok: false; reason: 'offline' }

async function fetchLatestRelease(): Promise<LatestRelease> {
  let res: Response
  try {
    res = await fetch(RELEASES_LATEST, {
      headers: { Accept: 'application/vnd.github+json' }
    })
  } catch {
    return { ok: false, reason: 'offline' }
  }
  if (!res.ok) return { ok: false, reason: 'unavailable' }
  const j = (await res.json()) as {
    tag_name?: string
    body?: string
    html_url?: string
    assets?: GithubAsset[]
  }
  if (!j.tag_name) return { ok: false, reason: 'unavailable' }
  return { ok: true, tag: j.tag_name, notes: j.body ?? '', url: j.html_url ?? '', assets: j.assets ?? [] }
}

// Only ever download an update from GitHub's own release CDN. The asset URL
// comes from the GitHub API, but pinning the host means a tampered/unexpected
// URL can't point the self-swap installer at an attacker-controlled server.
function isGithubReleaseUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname
    return h === 'github.com' || h === 'objects.githubusercontent.com' || h.endsWith('.githubusercontent.com')
  } catch {
    return false
  }
}

// The asset matching this machine: arm64 for Apple Silicon, x64 for Intel.
function macAsset(assets: GithubAsset[], ext: '.dmg' | '.zip'): string | null {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const hit = assets.find((a) => a.name.endsWith(ext) && a.name.includes(arch))
  const url = hit?.browser_download_url ?? null
  return url && isGithubReleaseUrl(url) ? url : null
}

// ---------- macOS self-swap ----------

// Stream the update .zip to a temp file, reporting percent over update:progress.
async function downloadMacZip(): Promise<void> {
  if (!macZipUrl) throw new Error('No update download available for this Mac.')
  // Belt-and-suspenders: never fetch the swap payload from a non-GitHub host.
  if (!isGithubReleaseUrl(macZipUrl)) throw new Error('Refusing to download update from an unexpected host.')
  const res = await fetch(macZipUrl)
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`)
  const total = Number(res.headers.get('content-length') || 0)
  const dest = path.join(app.getPath('temp'), `ClipRename-update-${Date.now()}.zip`)
  const out = createWriteStream(dest)
  const reader = res.body.getReader()
  let got = 0
  let lastPct = -1
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      got += value.byteLength
      await new Promise<void>((resolve, reject) =>
        out.write(value, (e) => (e ? reject(e) : resolve()))
      )
      if (total > 0) {
        const pct = Math.min(99, Math.round((got / total) * 100))
        if (pct !== lastPct) {
          lastPct = pct
          send('update:progress', { percent: pct })
        }
      }
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error) => (e ? reject(e) : resolve())))
  } catch (e) {
    out.destroy()
    await fs.unlink(dest).catch(() => {})
    throw e instanceof Error ? e : new Error(String(e))
  }
  if (total > 0 && got < total) throw new Error('The download stopped early — try again.')
  macZipPath = dest
}

// Swap the running .app bundle for the downloaded one and relaunch. The work
// happens in a detached shell script AFTER this process exits; any failure
// rolls the old bundle back, so the worst case is "nothing changed".
async function installMacUpdate(): Promise<void> {
  if (!macZipPath) return
  // …/ClipRename.app/Contents/MacOS/ClipRename → …/ClipRename.app
  const bundle = path.resolve(path.dirname(app.getPath('exe')), '..', '..')
  if (!bundle.endsWith('.app')) throw new Error('Could not locate the app bundle to replace.')
  const script = path.join(app.getPath('temp'), `cliprename-swap-${Date.now()}.sh`)
  await fs.writeFile(
    script,
    `#!/bin/bash
PID="$1"; ZIP="$2"; APP="$3"
while kill -0 "$PID" 2>/dev/null; do sleep 0.3; done
TMPD="$(mktemp -d)"
if ! ditto -xk "$ZIP" "$TMPD"; then open "$APP"; exit 1; fi
NEW="$(find "$TMPD" -maxdepth 1 -name '*.app' -print -quit)"
if [ -z "$NEW" ]; then open "$APP"; exit 1; fi
OLD="$TMPD/previous.app"
if ! mv "$APP" "$OLD"; then open "$APP"; exit 1; fi
if mv "$NEW" "$APP" 2>/dev/null || ditto "$NEW" "$APP"; then
  rm -rf "$TMPD" "$ZIP" 2>/dev/null
  open "$APP"
else
  mv "$OLD" "$APP"
  open "$APP"
  exit 1
fi
`,
    { mode: 0o755 }
  )
  const child = spawn('/bin/bash', [script, String(process.pid), macZipPath, bundle], {
    detached: true,
    stdio: 'ignore'
  })
  child.unref()
  app.quit()
}

export function registerUpdater(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('download-progress', (p) => {
    send('update:progress', { percent: Math.round(p.percent), bps: p.bytesPerSecond })
  })
  autoUpdater.on('update-downloaded', () => {
    downloadReady = true
    send('update:progress', { percent: 100, ready: true })
    // One-click flow: the user already pressed "Update now", so finish the job —
    // quit, install silently, and relaunch on the new version. The short beat
    // lets the renderer paint the "restarting…" note before the window closes.
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 1500)
  })
  autoUpdater.on('error', (e) => {
    send('update:progress', { error: e instanceof Error ? e.message : String(e) })
  })

  ipcMain.handle('update:check', async (): Promise<UpdateCheckResult> => {
    const current = app.getVersion()
    const base: UpdateCheckResult = {
      current,
      latest: current,
      available: false,
      canSelfUpdate: process.platform === 'win32' && app.isPackaged,
      notes: '',
      pageUrl: `https://github.com/${REPO}/releases/latest`
    }
    if (!app.isPackaged) return { ...base, devMode: true }
    const rel = await fetchLatestRelease()
    if (!rel.ok) {
      // Never surface this as a scary error — say plainly why we can't tell.
      return {
        ...base,
        note:
          rel.reason === 'offline'
            ? 'Couldn’t reach GitHub — check your internet connection and try again.'
            : 'The download page isn’t reachable right now (it may be private or have no release yet). You can check it yourself:'
      }
    }
    const latest = rel.tag.replace(/^v/, '')
    if (process.platform === 'darwin') {
      // A .zip for this CPU means the app can swap itself; older releases
      // (dmg-only) fall back to the guided browser download.
      macZipUrl = macAsset(rel.assets, '.zip')
    }
    return {
      ...base,
      latest,
      available: isNewer(latest, current),
      canSelfUpdate:
        app.isPackaged &&
        (process.platform === 'win32' || (process.platform === 'darwin' && !!macZipUrl)),
      notes: rel.notes,
      pageUrl: rel.url || base.pageUrl,
      downloadUrl:
        process.platform === 'darwin' ? macAsset(rel.assets, '.dmg') ?? undefined : undefined
    }
  })

  // Download in the background, then swap on restart (both OSes).
  ipcMain.handle('update:download', async () => {
    if (downloadStarted) return
    downloadStarted = true
    try {
      if (process.platform === 'darwin') {
        await downloadMacZip()
        downloadReady = true
        send('update:progress', { percent: 100, ready: true })
        // If the swap can't start (bundle not found, spawn fails), surface the
        // error and reset so the user isn't stuck on "restarting…" forever and
        // can try again — instead of the rejection being silently swallowed.
        setTimeout(() => {
          installMacUpdate().catch((e) => {
            downloadStarted = false
            downloadReady = false
            send('update:progress', {
              error: e instanceof Error ? e.message : String(e)
            })
          })
        }, 1500)
        return
      }
      await autoUpdater.checkForUpdates() // primes the updater's own state
      await autoUpdater.downloadUpdate()
    } catch (e) {
      downloadStarted = false
      const msg = e instanceof Error ? e.message : String(e)
      send('update:progress', { error: msg })
      throw e instanceof Error ? e : new Error(msg)
    }
  })

  // The "restart now" button — same place as the update, per the update UI.
  ipcMain.handle('update:install', () => {
    if (!downloadReady) return
    if (process.platform === 'darwin') {
      installMacUpdate().catch((e) => {
        downloadStarted = false
        downloadReady = false
        send('update:progress', { error: e instanceof Error ? e.message : String(e) })
      })
    } else autoUpdater.quitAndInstall()
  })

  // Fallback for releases without a self-update payload: open the download.
  ipcMain.handle('update:open', (_e, url: string) => {
    if (/^https:\/\/(github\.com|objects\.githubusercontent\.com)\//.test(url)) {
      void shell.openExternal(url)
    }
  })
}
