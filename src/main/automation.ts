import { BrowserWindow } from 'electron'
import chokidar, { FSWatcher } from 'chokidar'
import { promises as fs } from 'fs'
import path from 'path'
import { Category, MediaItem, WatchEvent, WatchRule, kindForExt, NamingStyle } from '../shared/types'
import { addWatchHistory, getWatchHistory, getWatchRules } from './store'
import { applyStyle, isGenericFilename, suggestNameCloud } from './ai'
import { extractAudioClip, extractFrames, prepImage, readEmbeddedTitle } from './media'
import { isSignedIn } from './cloud'
import { addToLibrary } from './library'

// Live watchers keyed by rule id. A folder watcher names + files new media the
// moment it lands, using the same pipeline as the manual flow.
const watchers = new Map<string, FSWatcher>()
const debounce = new Map<string, NodeJS.Timeout>()
// Paths we just produced (rename/copy output) — ignore them so we never loop.
const justWritten = new Set<string>()
// Everything each rule has already seen (pre-existing files + handled ones),
// so the periodic sweep can tell genuinely-new files from old ones.
const knownFiles = new Map<string, Set<string>>()
// Files currently being processed — the sweep must not double-process them.
const inFlight = new Set<string>()
let sweepTimer: NodeJS.Timeout | null = null

function emit(ev: WatchEvent): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('automation:event', ev)
  }
}

function hashStr(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h).toString(36)
}

async function buildItem(filePath: string): Promise<MediaItem | null> {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  const kind = kindForExt(ext)
  if (kind === 'other') return null
  let st: import('fs').Stats
  try {
    st = await fs.stat(filePath)
  } catch {
    return null
  }
  if (!st.isFile()) return null
  const originalName = path.basename(filePath)
  return {
    id: 'w' + hashStr(filePath),
    path: filePath,
    dir: path.dirname(filePath),
    originalName,
    baseName: originalName.replace(/\.[^.]+$/, ''),
    ext,
    kind,
    sizeBytes: st.size,
    mtimeMs: st.mtimeMs
  }
}

// Name one file through the account AI — 1 credit per file, exactly like doing
// it by hand. No offline fallback: if the AI can't run (signed out, quota used
// up, no network), the file is left untouched and the reason lands in the
// activity feed. Automation never renames for free or pretends the AI ran.
async function nameItem(
  item: MediaItem,
  style: NamingStyle
): Promise<{ name: string; category?: Category | string; tags?: string[]; description?: string }> {
  if (!isSignedIn()) {
    throw new Error('Signed out — sign in to your ClipRename account to keep automation running.')
  }
  const generic = isGenericFilename(item.baseName)
  const metaTitle =
    generic && item.kind !== 'image' ? await readEmbeddedTitle(item.path).catch(() => null) : null
  const media =
    item.kind === 'video'
      ? await extractFrames(item.path, 5)
      : item.kind === 'image'
        ? await prepImage(item.path)
        : item.kind === 'audio'
          ? await extractAudioClip(item.path)
          : null
  const r = await suggestNameCloud(item, media, { ignoreFilename: generic, metaTitle })
  return { ...r, name: applyStyle(r.name, style, item.mtimeMs) }
}

function safeBase(name: string, fallback: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim() || fallback
}

async function uniquePath(dir: string, base: string, ext: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true })
  let candidate = path.join(dir, `${base}.${ext}`)
  let n = 1
  while (true) {
    try {
      await fs.access(candidate)
      candidate = path.join(dir, `${base}-${n}.${ext}`)
      n++
    } catch {
      return candidate
    }
  }
}

async function applyRule(
  item: MediaItem,
  newName: string,
  rule: WatchRule
): Promise<string> {
  const base = safeBase(newName, item.baseName)
  if (rule.mode === 'rename') {
    const dest = await uniquePath(item.dir, base, item.ext)
    await fs.rename(item.path, dest)
    return dest
  }
  const destDir = path.join(item.dir, rule.subfolder || 'Renamed')
  const dest = await uniquePath(destDir, base, item.ext)
  if (rule.mode === 'move') {
    await fs.rename(item.path, dest).catch(async () => {
      await fs.copyFile(item.path, dest)
      await fs.unlink(item.path).catch(() => {})
    })
  } else {
    await fs.copyFile(item.path, dest)
  }
  return dest
}

async function process(filePath: string, rule: WatchRule): Promise<void> {
  if (justWritten.has(filePath)) {
    justWritten.delete(filePath)
    return
  }
  if (inFlight.has(filePath)) return
  inFlight.add(filePath)
  try {
    const item = await buildItem(filePath)
    if (!item) return
    emit({
      ruleId: rule.id,
      folder: rule.folder,
      file: filePath,
      newName: '',
      at: Date.now(),
      status: 'processing',
      message: `Naming ${item.originalName}…`
    })
    const named = await nameItem(item, rule.style)
    const dest = await applyRule(item, named.name, rule)
    justWritten.add(dest)
    // Forget the guard after a moment so the path can be reused later.
    setTimeout(() => justWritten.delete(dest), 10000)
    // Our own output is permanently "known": if the live watcher misses the
    // rename event, the sweep must NOT treat the result as a new file — that
    // would re-rename it (…-1, …-2) on every sweep pass.
    markKnown(rule.id, dest)
    await addToLibrary([
      {
        ...item,
        path: dest,
        suggestedName: named.name,
        category: named.category as Category,
        tags: named.tags ?? [],
        description: named.description ?? ''
      }
    ]).catch(() => {})
    // Persist the change so the panel can show "what got renamed in this
    // folder" even after a restart — not just the live session feed.
    addWatchHistory({
      ruleId: rule.id,
      folder: rule.folder,
      oldName: path.basename(filePath),
      newName: path.basename(dest),
      mode: rule.mode,
      at: Date.now()
    })
    emit({
      ruleId: rule.id,
      folder: rule.folder,
      file: filePath,
      newName: path.basename(dest),
      at: Date.now(),
      status: 'named',
      message: `${path.basename(filePath)} → ${path.basename(dest)}`
    })
  } catch (e) {
    emit({
      ruleId: rule.id,
      folder: rule.folder,
      file: filePath,
      newName: '',
      at: Date.now(),
      status: 'error',
      error: e instanceof Error ? e.message : String(e)
    })
  } finally {
    inFlight.delete(filePath)
  }
}

// Note a path as belonging to a rule's known set.
function markKnown(ruleId: string, filePath: string): void {
  let set = knownFiles.get(ruleId)
  if (!set) {
    set = new Set()
    knownFiles.set(ruleId, set)
  }
  set.add(filePath)
}

// List the media files sitting at the top level of a folder right now.
async function listMedia(folder: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => path.join(folder, e.name))
      .filter((p) => kindForExt(path.extname(p).slice(1).toLowerCase()) !== 'other')
  } catch {
    return []
  }
}

// How many media files a folder already holds — shown when adding a watch
// rule so the user can decide whether the existing clips should be renamed too.
export async function countExistingMedia(folder: string): Promise<number> {
  return (await listMedia(folder)).length
}

// The folder's current top-level media, for the panel's preview grid — so the
// user can SEE what a watch rule would rename before spending credits.
export async function listFolderMedia(
  folder: string
): Promise<{ path: string; name: string }[]> {
  const files = await listMedia(folder)
  return files.map((p) => ({ path: p, name: path.basename(p) }))
}

// One-time pass over the files that were ALREADY in the folder when the rule
// was created. Watchers deliberately skip pre-existing files; this runs them
// through the exact same pipeline (same naming, same 1-credit-per-file cost)
// when the user explicitly asks for it. Runs sequentially so a folder full of
// clips doesn't slam the AI with parallel calls.
export async function processExisting(ruleId: string): Promise<void> {
  const rule = getWatchRules().find((r) => r.id === ruleId)
  if (!rule) return
  // Skip clips this rule already renamed once (their old name is in the
  // history) — clicking "Name all" twice must not copy/rename them again.
  const alreadyDone = new Set(getWatchHistory(rule.id).map((h) => h.oldName))
  const files = (await listMedia(rule.folder)).filter(
    (p) => !alreadyDone.has(path.basename(p))
  )
  if (files.length === 0) {
    // Say so — a silent no-op here looks like "renaming is broken".
    emit({
      ruleId: rule.id,
      folder: rule.folder,
      file: rule.folder,
      newName: '',
      at: Date.now(),
      status: 'found',
      message:
        'No clips to rename at the top level of this folder (clips inside subfolders aren’t watched, and already-renamed clips are skipped).'
    })
    return
  }
  emit({
    ruleId: rule.id,
    folder: rule.folder,
    file: files[0],
    newName: '',
    at: Date.now(),
    status: 'found',
    message: `Renaming ${files.length} clip${files.length === 1 ? '' : 's'} already in the folder…`
  })
  for (const p of files) {
    // Skip anything the rule already produced or is mid-processing.
    if (justWritten.has(p) || inFlight.has(p)) continue
    markKnown(rule.id, p)
    await process(p, rule)
  }
}

// Safety net: folder watchers can miss files (network drives, some cloud-sync
// folders, bursts of copies). Every 45s each rule re-lists its folder; any
// media file the watcher never reported gets announced AND processed, so
// nothing silently slips through.
async function sweep(): Promise<void> {
  const rules = getWatchRules().filter((r) => r.enabled && watchers.has(r.id))
  for (const rule of rules) {
    const known = knownFiles.get(rule.id) ?? new Set<string>()
    const current = await listMedia(rule.folder)
    const missed: string[] = []
    for (const p of current) {
      if (known.has(p) || justWritten.has(p) || inFlight.has(p) || debounce.has(p)) continue
      // Skip files still being written — only pick up ones quiet for a bit.
      try {
        const st = await fs.stat(p)
        if (Date.now() - st.mtimeMs < 4000) continue
      } catch {
        continue
      }
      missed.push(p)
    }
    if (missed.length === 0) continue
    emit({
      ruleId: rule.id,
      folder: rule.folder,
      file: missed[0],
      newName: '',
      at: Date.now(),
      status: 'missed',
      message: `Found ${missed.length} new clip${missed.length === 1 ? '' : 's'} the watcher missed — processing now`
    })
    for (const p of missed) {
      markKnown(rule.id, p)
      await process(p, rule)
    }
  }
}

function startRule(rule: WatchRule): void {
  if (!rule.enabled || watchers.has(rule.id)) return
  // Snapshot what's already in the folder: those files are old news — only
  // what arrives (or appears) after this point should be touched.
  void listMedia(rule.folder).then((existing) => {
    for (const p of existing) markKnown(rule.id, p)
  })
  const w = chokidar.watch(rule.folder, {
    ignoreInitial: true, // only act on files that arrive after we start
    depth: 0, // top level only — never re-scan our own output subfolders
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
    ignored: /(^|[/\\])\../ // dotfiles
  })
  w.on('add', (fp) => {
    markKnown(rule.id, fp)
    if (!justWritten.has(fp) && kindForExt(path.extname(fp).slice(1).toLowerCase()) !== 'other') {
      emit({
        ruleId: rule.id,
        folder: rule.folder,
        file: fp,
        newName: '',
        at: Date.now(),
        status: 'found',
        message: `New clip detected: ${path.basename(fp)}`
      })
    }
    const prev = debounce.get(fp)
    if (prev) clearTimeout(prev)
    debounce.set(
      fp,
      setTimeout(() => {
        debounce.delete(fp)
        void process(fp, rule)
      }, 400)
    )
  })
  watchers.set(rule.id, w)
}

export function stopRule(id: string): void {
  const w = watchers.get(id)
  if (w) {
    void w.close()
    watchers.delete(id)
  }
  knownFiles.delete(id)
}

// Reconcile live watchers with the saved + enabled rules.
export function syncWatchers(): void {
  const rules = getWatchRules()
  const want = new Set(rules.filter((r) => r.enabled).map((r) => r.id))
  for (const id of [...watchers.keys()]) if (!want.has(id)) stopRule(id)
  for (const r of rules) if (r.enabled) startRule(r)
  // The missed-file sweep runs only while at least one folder is watched.
  if (watchers.size > 0 && !sweepTimer) {
    sweepTimer = setInterval(() => void sweep(), 45_000)
  } else if (watchers.size === 0 && sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
}

export function stopAllWatchers(): void {
  for (const id of [...watchers.keys()]) stopRule(id)
  if (sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
}
