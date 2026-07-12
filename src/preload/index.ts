import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  AgentRunOptions,
  ApplyOptions,
  ApplyResult,
  AppSettings,
  AutoClipAnalysis,
  DuplicateGroup,
  JournalEntry,
  LibraryEntry,
  LibraryQuery,
  MediaItem,
  EditImageRequest,
  NleExportOptions,
  Preset,
  SceneSplitResult,
  ScanResult,
  SortAssignment,
  SortPlan,
  StageRequest,
  SuggestProgress,
  UpdateCheckResult,
  UpdateProgress,
  WatchEvent,
  WatchHistoryEntry,
  WatchRule
} from '../shared/types'

const api = {
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:set', patch),

  // Resolve the absolute path of a dropped File (replaces removed File.path).
  pathForFile: (file: File): string => webUtils.getPathForFile(file),

  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:pickFiles'),
  pickOutputDir: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickOutputDir'),
  pickSaveFile: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveFile', defaultName),

  scan: (root: string): Promise<ScanResult> => ipcRenderer.invoke('fs:scan', root),
  scanPaths: (paths: string[]): Promise<ScanResult> => ipcRenderer.invoke('fs:scanPaths', paths),
  // Folder Agent: recursive video/audio-only scan + rename in place / copy /
  // move into a new subfolder.
  agentScan: (root: string): Promise<ScanResult> => ipcRenderer.invoke('fs:agentScan', root),
  runAgent: (root: string, items: MediaItem[], options: AgentRunOptions): Promise<ApplyResult> =>
    ipcRenderer.invoke('fs:runAgent', root, items, options),
  ffmpegAvailable: (): Promise<boolean> => ipcRenderer.invoke('ffmpeg:available'),
  thumb: (filePath: string, kind: string): Promise<string | null> =>
    ipcRenderer.invoke('media:thumb', filePath, kind),

  suggest: (items: MediaItem[]): Promise<{ items: MediaItem[]; sandbox: boolean }> =>
    ipcRenderer.invoke('ai:suggest', items),
  onSuggestProgress: (cb: (p: SuggestProgress) => void): (() => void) => {
    const handler = (_e: unknown, p: SuggestProgress): void => cb(p)
    ipcRenderer.on('ai:suggest:progress', handler)
    return () => ipcRenderer.removeListener('ai:suggest:progress', handler)
  },

  planSort: (instruction: string, items: MediaItem[]): Promise<SortPlan> =>
    ipcRenderer.invoke('ai:planSort', instruction, items),
  nameClip: (
    item: MediaItem,
    startSec?: number,
    endSec?: number
  ): Promise<{
    name: string
    category?: string
    tags?: string[]
    description?: string
    // Set when the name is an offline fallback (signed out / AI call failed) —
    // the plain-language reason, so the UI never passes it off as an AI result.
    error?: string
  }> => ipcRenderer.invoke('ai:nameClip', item, startSec, endSec),

  apply: (items: MediaItem[], options: ApplyOptions): Promise<ApplyResult> =>
    ipcRenderer.invoke('fs:apply', items, options),
  applySort: (
    items: MediaItem[],
    assignments: SortAssignment[],
    options: ApplyOptions
  ): Promise<ApplyResult> => ipcRenderer.invoke('fs:applySort', items, assignments, options),

  journals: (): Promise<JournalEntry[]> => ipcRenderer.invoke('fs:journals'),
  undo: (journalId: string): Promise<{ undone: number; errors: string[] }> =>
    ipcRenderer.invoke('fs:undo', journalId),

  // Clipping & drag-out tray
  clipUrl: (p: string): string => `clipfile://media/${encodeURIComponent(p)}`,
  mediaInfo: (p: string): Promise<{ durationSec: number; width: number; height: number }> =>
    ipcRenderer.invoke('media:info', p),
  filmstrip: (p: string, durationSec: number, count?: number): Promise<string[]> =>
    ipcRenderer.invoke('media:filmstrip', p, durationSec, count),
  waveform: (p: string): Promise<string | null> => ipcRenderer.invoke('media:waveform', p),
  detectBeats: (p: string): Promise<{ beats: number[]; bpm: number }> =>
    ipcRenderer.invoke('media:beats', p),
  saveMarkers: (baseName: string, beats: number[], bpm: number): Promise<{ folder: string }> =>
    ipcRenderer.invoke('clip:saveMarkers', baseName, beats, bpm),
  stageClip: (req: StageRequest): Promise<{ stagedPath: string; fallback?: boolean }> =>
    ipcRenderer.invoke('clip:stage', req),
  editImage: (req: EditImageRequest): Promise<{ stagedPath: string; fallback?: boolean }> =>
    ipcRenderer.invoke('clip:editImage', req),
  removeStaged: (p: string): Promise<void> => ipcRenderer.invoke('clip:removeStaged', p),
  revealTray: (): Promise<string> => ipcRenderer.invoke('tray:reveal'),
  trayFolder: (): Promise<string> => ipcRenderer.invoke('tray:folder'),
  startDrag: (files: string[]): void => ipcRenderer.send('drag:start', files),

  // ClipRename account — same login, plan, and quotas as cliprename.com.
  cloudStatus: (): Promise<{ signedIn: boolean; email: string; tier: string }> =>
    ipcRenderer.invoke('cloud:status'),
  cloudSignIn: (
    email: string,
    password: string
  ): Promise<{ signedIn: boolean; email: string; tier: string }> =>
    ipcRenderer.invoke('cloud:signIn', email, password),
  cloudSignInGoogle: (): Promise<{ signedIn: boolean; email: string; tier: string }> =>
    ipcRenderer.invoke('cloud:signInGoogle'),
  cloudSignOut: (): Promise<void> => ipcRenderer.invoke('cloud:signOut'),
  cloudUsage: (): Promise<{
    tier: string
    daily: number
    dailyLimit: number
    monthly: number
    monthlyLimit: number
  }> => ipcRenderer.invoke('cloud:usage'),
  cloudPortal: (): Promise<void> => ipcRenderer.invoke('cloud:portal'),

  // ok=false → file AND its folder are gone; openedFolder → file moved, we
  // opened where it used to live instead.
  reveal: (p: string): Promise<{ ok: boolean; openedFolder?: boolean }> =>
    ipcRenderer.invoke('shell:reveal', p),
  openPath: (p: string): Promise<string> => ipcRenderer.invoke('shell:openPath', p),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),

  // ---- NLE handoff ----
  exportNle: (items: MediaItem[], opts: NleExportOptions): Promise<{ path: string; count: number }> =>
    ipcRenderer.invoke('nle:export', items, opts),

  // ---- Persistent library + search + duplicates ----
  libraryAdd: (items: MediaItem[]): Promise<{ added: number; total: number }> =>
    ipcRenderer.invoke('library:add', items),
  libraryAll: (): Promise<LibraryEntry[]> => ipcRenderer.invoke('library:all'),
  librarySearch: (query: LibraryQuery): Promise<LibraryEntry[]> =>
    ipcRenderer.invoke('library:search', query),
  libraryDuplicates: (): Promise<DuplicateGroup[]> => ipcRenderer.invoke('library:duplicates'),
  libraryRemove: (ids: string[]): Promise<number> => ipcRenderer.invoke('library:remove', ids),
  libraryClear: (): Promise<boolean> => ipcRenderer.invoke('library:clear'),
  libraryIndexFolder: (root: string): Promise<{ added: number; total: number }> =>
    ipcRenderer.invoke('library:indexFolder', root),

  // ---- Scene-out split ----
  splitScenes: (filePath: string, baseName: string, threshold?: number): Promise<SceneSplitResult> =>
    ipcRenderer.invoke('media:splitScenes', filePath, baseName, threshold),

  // ---- Auto clipper ----
  autoClip: (
    filePath: string,
    baseName: string,
    opts?: { mode?: 'silence' | 'still'; strength?: 'gentle' | 'balanced' | 'aggressive' }
  ): Promise<{
    outputDir: string
    clips: { path: string; startSec: number; endSec: number }[]
    removedSec: number
    totalSec: number
    analysis?: AutoClipAnalysis
  }> => ipcRenderer.invoke('media:autoClip', filePath, baseName, opts),

  // ---- Preset recipes ----
  presetsAll: (): Promise<Preset[]> => ipcRenderer.invoke('presets:all'),
  presetSave: (preset: Preset): Promise<Preset[]> => ipcRenderer.invoke('presets:save', preset),
  presetDelete: (id: string): Promise<Preset[]> => ipcRenderer.invoke('presets:delete', id),

  // ---- In-app updates ----
  updateCheck: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('update:check'),
  updateDownload: (): Promise<void> => ipcRenderer.invoke('update:download'),
  updateInstall: (): Promise<void> => ipcRenderer.invoke('update:install'),
  updateOpen: (url: string): Promise<void> => ipcRenderer.invoke('update:open', url),
  onUpdateProgress: (cb: (p: UpdateProgress) => void): (() => void) => {
    const handler = (_e: unknown, p: UpdateProgress): void => cb(p)
    ipcRenderer.on('update:progress', handler)
    return () => ipcRenderer.removeListener('update:progress', handler)
  },

  // ---- Watch-folder automation ----
  watchAll: (): Promise<WatchRule[]> => ipcRenderer.invoke('watch:all'),
  watchSave: (rule: WatchRule): Promise<WatchRule[]> => ipcRenderer.invoke('watch:save', rule),
  watchDelete: (id: string): Promise<WatchRule[]> => ipcRenderer.invoke('watch:delete', id),
  watchHistory: (ruleId?: string): Promise<WatchHistoryEntry[]> =>
    ipcRenderer.invoke('watch:history', ruleId),
  watchExistingCount: (folder: string): Promise<number> =>
    ipcRenderer.invoke('watch:existingCount', folder),
  watchProcessExisting: (ruleId: string): Promise<void> =>
    ipcRenderer.invoke('watch:processExisting', ruleId),
  onAutomationEvent: (cb: (e: WatchEvent) => void): (() => void) => {
    const handler = (_e: unknown, ev: WatchEvent): void => cb(ev)
    ipcRenderer.on('automation:event', handler)
    return () => ipcRenderer.removeListener('automation:event', handler)
  }
}

export type ClipRenameApi = typeof api

contextBridge.exposeInMainWorld('api', api)
