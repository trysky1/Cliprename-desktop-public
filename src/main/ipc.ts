import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import { existsSync, promises as fsp } from 'fs'
import { DRAG_ICON_B64 } from './dragicon'
import {
  AgentRunOptions,
  ApplyOptions,
  LibraryQuery,
  MediaItem,
  NleExportOptions,
  Preset,
  SortAssignment,
  SuggestProgress,
  WatchRule
} from '../shared/types'
import {
  deletePreset,
  deleteWatchRule,
  getPresets,
  getSettings,
  getWatchHistory,
  getWatchRules,
  savePreset,
  saveWatchRule,
  setSettings
} from './store'
import { buildFcpxml, buildPremiereXml, NleClip } from './nle'
import {
  addToLibrary,
  clearLibrary,
  findDuplicates,
  getLibrary,
  removeFromLibrary,
  searchLibrary
} from './library'
import { countExistingMedia, listFolderMedia, processExisting, syncWatchers } from './automation'
import {
  applyPlan,
  buildPlan,
  buildPlanFromAssignments,
  listJournals,
  runAgent,
  scanAgent,
  scanFolder,
  scanPaths,
  undoJournal
} from './files'
import {
  audioRange,
  autoClip,
  detectBeats,
  editImage,
  extractAudioClip,
  extractFrames,
  extractKeyframe,
  filmstrip,
  frameAt,
  getMediaInfo,
  isFfmpegAvailable,
  makeThumbnail,
  prepImage,
  readEmbeddedTitle,
  removeStaged,
  saveBeatMarkers,
  splitScenes,
  stageClip,
  stagingDir,
  waveform,
  MediaPart
} from './media'
import { applyStyle, isGenericFilename, planSortCloud, sandboxName, suggestNameCloud } from './ai'
import {
  isSignedIn,
  portalUrl,
  signIn,
  signInWithGoogle,
  signOut,
  status as cloudStatus,
  usage as cloudUsage
} from './cloud'

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = new Array(Math.min(limit, items.length || 1)).fill(0).map(async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) break
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

async function mediaForItem(item: MediaItem): Promise<MediaPart | null> {
  if (item.kind === 'video') return extractKeyframe(item.path)
  if (item.kind === 'image') return prepImage(item.path)
  if (item.kind === 'audio') return extractAudioClip(item.path)
  return null
}

export function registerIpc(): void {
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch) => setSettings(patch))

  ipcMain.handle('dialog:pickFolder', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
      title: 'Select a project folder to organize'
    })
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
  })

  ipcMain.handle('dialog:pickFiles', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      title: 'Choose files to rename'
    })
    return res.canceled ? [] : res.filePaths
  })

  ipcMain.handle('dialog:pickOutputDir', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select an output folder'
    })
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
  })

  ipcMain.handle('dialog:saveFile', async (_e, defaultName: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const res = await dialog.showSaveDialog(win!, {
      defaultPath: defaultName,
      title: 'Export a project for your editor'
    })
    return res.canceled || !res.filePath ? null : res.filePath
  })

  ipcMain.handle('fs:scan', async (_e, root: string) => scanFolder(root))
  ipcMain.handle('fs:scanPaths', async (_e, paths: string[]) => scanPaths(paths))
  ipcMain.handle('fs:agentScan', async (_e, root: string) => scanAgent(root))
  ipcMain.handle(
    'fs:runAgent',
    async (_e, root: string, items: MediaItem[], options: AgentRunOptions) =>
      runAgent(root, items, options)
  )

  ipcMain.handle('ffmpeg:available', () => isFfmpegAvailable())
  ipcMain.handle('media:thumb', async (_e, filePath: string, kind: string) =>
    makeThumbnail(filePath, kind)
  )

  // Analyze a batch of items -> emits per-item progress, resolves with final list.
  ipcMain.handle('ai:suggest', async (event, items: MediaItem[]) => {
    // Signed-in account is the only AI provider: same AI, quotas, and plan
    // enforcement as cliprename.com, no key on this machine at all. Every
    // feature requires the account — 1 credit per file analyzed.
    if (!isSignedIn()) {
      throw new Error('Sign in to your ClipRename account to use AI naming.')
    }
    const total = items.length

    const send = (p: SuggestProgress): void => {
      if (!event.sender.isDestroyed()) event.sender.send('ai:suggest:progress', p)
    }

    const done = await mapWithConcurrency(items, 3, async (item, index) => {
      send({ id: item.id, index, total, status: 'analyzing' })
      try {
        // Meaningless camera/timestamp names (OBS, DSC_0001, …) must be named
        // from content, not echoed. Only then do we spend a metadata probe — a
        // real embedded title names the file with no AI at all.
        const generic = isGenericFilename(item.baseName)
        const metaTitle =
          generic && item.kind !== 'image'
            ? await readEmbeddedTitle(item.path).catch(() => null)
            : null
        // Website pipeline: multi-frame for video, full file for image/audio.
        const media =
          item.kind === 'video' ? await extractFrames(item.path, 6) : await mediaForItem(item)
        const result = await suggestNameCloud(item, media, { ignoreFilename: generic, metaTitle })
        // Honour the chosen naming style (spaces / underscores / add-the-date)
        // — the cloud returns a bare descriptive name, same as automation does.
        const styledName = applyStyle(result.name, getSettings().style, item.mtimeMs)
        const payload: SuggestProgress = {
          id: item.id,
          index,
          total,
          status: 'done',
          suggestedName: styledName,
          category: result.category,
          tags: result.tags,
          description: result.description,
          actionGroup: result.actionGroup
        }
        send(payload)
        return {
          ...item,
          suggestedName: styledName,
          category: result.category,
          tags: result.tags,
          description: result.description,
          actionGroup: result.actionGroup,
          status: 'done' as const
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        send({ id: item.id, index, total, status: 'error', error: msg })
        return { ...item, status: 'error' as const, error: msg }
      }
    })

    // No two files in a batch may share the same suggested name. Duplicates get
    // a numeric variation ("mbappe goal 2" / "mbappe-goal-2", matching the
    // name's own separator) and a corrected progress event so the UI updates.
    const seen = new Map<string, number>()
    const unique = done.map((it, i) => {
      if (!it.suggestedName) return it
      const key = it.suggestedName.trim().toLowerCase()
      const count = seen.get(key) ?? 0
      seen.set(key, count + 1)
      if (count === 0) return it
      const sep = it.suggestedName.includes(' ') ? ' ' : '-'
      let n = count + 1
      let candidate = `${it.suggestedName}${sep}${n}`
      while (seen.has(candidate.trim().toLowerCase())) {
        n++
        candidate = `${it.suggestedName}${sep}${n}`
      }
      seen.set(candidate.trim().toLowerCase(), 1)
      send({ id: it.id, index: i, total, status: 'done', suggestedName: candidate })
      return { ...it, suggestedName: candidate }
    })

    return { items: unique, sandbox: false }
  })

  // Name a single clip based on the part the user selected in the editor.
  ipcMain.handle(
    'ai:nameClip',
    async (_e, item: MediaItem, startSec?: number, endSec?: number) => {
      const settings = getSettings()
      const generic = isGenericFilename(item.baseName)
      const metaTitle =
        generic && item.kind !== 'image'
          ? await readEmbeddedTitle(item.path).catch(() => null)
          : null
      if (!isSignedIn()) {
        throw new Error('Sign in to your ClipRename account to use AI naming.')
      }
      try {
        // Honour the selected range: the user pays 1 credit to name the PART
        // they trimmed, so sample inside [startSec, endSec] when one is given.
        const hasRange =
          typeof startSec === 'number' &&
          typeof endSec === 'number' &&
          isFinite(startSec) &&
          isFinite(endSec) &&
          endSec > startSec
        let media: MediaPart[] | MediaPart | null
        if (hasRange && item.kind === 'video') {
          const n = 5
          const step = (endSec - startSec) / (n + 1)
          const frames = await Promise.all(
            Array.from({ length: n }, (_, i) => frameAt(item.path, startSec + step * (i + 1)))
          )
          const got = frames.filter((f): f is MediaPart => !!f)
          media = got.length ? got : await extractFrames(item.path, 5)
        } else if (hasRange && item.kind === 'audio') {
          media = (await audioRange(item.path, startSec, endSec - startSec)) ?? (await mediaForItem(item))
        } else {
          media = item.kind === 'video' ? await extractFrames(item.path, 5) : await mediaForItem(item)
        }
        const r = await suggestNameCloud(item, media, { ignoreFilename: generic, metaTitle })
        // Same style pass as the batch flow, so the editor's single-clip rename
        // respects the naming-style setting too.
        return { ...r, name: applyStyle(r.name, settings.style, item.mtimeMs) }
      } catch (e) {
        return {
          ...sandboxName(item, { metaTitle, style: settings.style }),
          error: e instanceof Error ? e.message : String(e)
        }
      }
    }
  )

  ipcMain.handle('ai:planSort', async (_e, instruction: string, items: MediaItem[]) => {
    if (!isSignedIn()) {
      return {
        possible: false,
        reason: 'Chat sorting needs the real AI — sign in to your ClipRename account first.',
        message: 'Sign in to your ClipRename account in Settings to use chat sorting.',
        options: []
      }
    }
    try {
      return await planSortCloud(instruction, items)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { possible: false, reason: msg, message: msg, options: [] }
    }
  })

  // ---- ClipRename account (same login, plans & quotas as cliprename.com) ----
  ipcMain.handle('cloud:status', () => cloudStatus())
  ipcMain.handle('cloud:signIn', async (_e, email: string, password: string) =>
    signIn(email, password)
  )
  ipcMain.handle('cloud:signInGoogle', () => signInWithGoogle())
  ipcMain.handle('cloud:signOut', () => signOut())
  ipcMain.handle('cloud:usage', () => cloudUsage())
  ipcMain.handle('cloud:portal', async () => {
    const url = await portalUrl()
    await shell.openExternal(url)
  })

  // ---- NLE handoff: export an organized project file for the editor ----
  ipcMain.handle('nle:export', async (_e, items: MediaItem[], opts: NleExportOptions) => {
    const clips: NleClip[] = []
    for (const it of items) {
      if (!it.suggestedName && !it.baseName) continue
      let durationSec = 0
      let width = 0
      let height = 0
      if (it.kind === 'video' || it.kind === 'audio') {
        try {
          const info = await getMediaInfo(it.path)
          durationSec = info.durationSec
          width = info.width
          height = info.height
        } catch {
          /* keep zeros — builder falls back to a default length */
        }
      }
      const bin =
        opts.groupBy === 'action'
          ? it.actionGroup || it.category || 'Unsorted'
          : it.category || 'Unsorted'
      clips.push({
        path: it.path,
        name: it.suggestedName || it.baseName,
        ext: it.ext,
        kind: it.kind,
        bin: String(bin),
        description: it.description || '',
        tags: it.tags || [],
        durationSec,
        width,
        height
      })
    }
    const content = opts.target === 'premiere' ? buildPremiereXml(clips) : buildFcpxml(clips)
    await fsp.writeFile(opts.destPath, content, 'utf8')
    return { path: opts.destPath, count: clips.length }
  })

  // ---- Persistent library + search + duplicate detection ----
  ipcMain.handle('library:add', async (_e, items: MediaItem[]) => addToLibrary(items))
  ipcMain.handle('library:all', () => getLibrary())
  ipcMain.handle('library:search', (_e, query: LibraryQuery) => searchLibrary(query))
  ipcMain.handle('library:duplicates', () => findDuplicates())
  ipcMain.handle('library:remove', (_e, ids: string[]) => removeFromLibrary(ids))
  ipcMain.handle('library:clear', () => {
    clearLibrary()
    return true
  })
  // Index a folder (scan + hash) purely to find duplicates — no renaming.
  ipcMain.handle('library:indexFolder', async (_e, root: string) => {
    const scan = await scanFolder(root)
    return addToLibrary(scan.items)
  })

  // ---- Scene-out split ----
  ipcMain.handle(
    'media:splitScenes',
    async (_e, filePath: string, baseName: string, threshold?: number) =>
      splitScenes(filePath, baseName, { threshold })
  )

  // ---- Auto clipper: cut silence / still parts, keep the good segments ----
  ipcMain.handle(
    'media:autoClip',
    async (
      _e,
      filePath: string,
      baseName: string,
      opts?: { mode?: 'silence' | 'still'; strength?: 'gentle' | 'balanced' | 'aggressive' }
    ) => autoClip(filePath, baseName, opts)
  )

  // ---- Preset recipes ----
  ipcMain.handle('presets:all', () => getPresets())
  ipcMain.handle('presets:save', (_e, preset: Preset) => savePreset(preset))
  ipcMain.handle('presets:delete', (_e, id: string) => deletePreset(id))

  // ---- Watch-folder automation ----
  ipcMain.handle('watch:all', () => getWatchRules())
  ipcMain.handle('watch:save', (_e, rule: WatchRule) => {
    const list = saveWatchRule(rule)
    syncWatchers()
    return list
  })
  ipcMain.handle('watch:history', (_e, ruleId?: string) => getWatchHistory(ruleId))
  // Existing-clips flow: count what's already in a folder (shown before the
  // rule is saved), then process those files on explicit request. Fire-and-
  // forget: progress streams over the normal automation events.
  ipcMain.handle('watch:existingCount', (_e, folder: string) => countExistingMedia(folder))
  ipcMain.handle('watch:listMedia', (_e, folder: string) => listFolderMedia(folder))
  ipcMain.handle('watch:processExisting', (_e, ruleId: string) => {
    void processExisting(ruleId)
  })
  ipcMain.handle('watch:delete', (_e, id: string) => {
    const list = deleteWatchRule(id)
    syncWatchers()
    return list
  })

  ipcMain.handle('fs:apply', async (_e, items: MediaItem[], options: ApplyOptions) => {
    const plan = buildPlan(items, options)
    return applyPlan(plan, options)
  })

  ipcMain.handle(
    'fs:applySort',
    async (_e, items: MediaItem[], assignments: SortAssignment[], options: ApplyOptions) => {
      const plan = buildPlanFromAssignments(items, assignments)
      return applyPlan(plan, options)
    }
  )

  ipcMain.handle('fs:journals', () => listJournals())
  ipcMain.handle('fs:undo', (_e, journalId: string) => undoJournal(journalId))

  // ---- Clipping & drag-out tray ----
  ipcMain.handle('media:info', (_e, p: string) => getMediaInfo(p))
  ipcMain.handle('media:filmstrip', (_e, p: string, dur: number, count?: number) =>
    filmstrip(p, dur, count)
  )
  ipcMain.handle('media:waveform', (_e, p: string) => waveform(p))
  ipcMain.handle('media:beats', (_e, p: string) => detectBeats(p))
  ipcMain.handle('clip:saveMarkers', (_e, baseName: string, beats: number[], bpm: number) =>
    saveBeatMarkers(baseName, beats, bpm)
  )
  ipcMain.handle('clip:stage', (_e, req) => stageClip(req))
  ipcMain.handle('clip:editImage', (_e, req) => editImage(req))
  ipcMain.handle('clip:removeStaged', (_e, p: string) => removeStaged(p))
  ipcMain.handle('tray:reveal', () => shell.openPath(stagingDir()))
  ipcMain.handle('tray:folder', () => stagingDir())

  const dragIcon = nativeImage.createFromDataURL(`data:image/png;base64,${DRAG_ICON_B64}`)
  // Native drag of real files OUT of the app into editors / Explorer.
  // NOTE: startDrag THROWS on Windows if the icon is empty or a path is bad,
  // which kills the drag silently — so validate everything and log failures.
  ipcMain.on('drag:start', (event, files: string[]) => {
    try {
      if (!Array.isArray(files) || files.length === 0) return
      const existing = files.filter((p) => typeof p === 'string' && existsSync(p))
      if (existing.length === 0) {
        console.error('[drag] none of the paths exist:', files)
        return
      }
      if (dragIcon.isEmpty()) {
        console.error('[drag] drag icon failed to decode — drag cannot start')
        return
      }
      event.sender.startDrag({ files: existing, file: existing[0], icon: dragIcon })
    } catch (e) {
      console.error('[drag] startDrag failed:', e)
    }
  })

  // Reveal in Finder/Explorer. showItemInFolder silently does NOTHING when
  // the file has since been renamed/moved (library entries can go stale), so
  // check first and fall back to opening the parent folder — and tell the
  // renderer which of the three cases happened so it can say so.
  ipcMain.handle('shell:reveal', async (_e, p: string) => {
    if (existsSync(p)) {
      shell.showItemInFolder(p)
      return { ok: true }
    }
    const dir = p.replace(/[\\/][^\\/]+$/, '')
    if (dir && existsSync(dir)) {
      await shell.openPath(dir)
      return { ok: true, openedFolder: true }
    }
    return { ok: false }
  })
  ipcMain.handle('shell:openPath', (_e, p: string) => shell.openPath(p))
  ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url))
}
