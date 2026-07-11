// Shared types & constants used by both the main and renderer processes.

export type MediaKind = 'video' | 'audio' | 'image' | 'other'

export const VIDEO_EXTS = [
  'mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mpg', 'mpeg', 'wmv', 'flv',
  'mts', 'm2ts', 'braw', 'r3d', 'mxf', 'prores'
]
export const AUDIO_EXTS = [
  'mp3', 'wav', 'aac', 'flac', 'm4a', 'ogg', 'aiff', 'aif', 'wma', 'opus'
]
export const IMAGE_EXTS = [
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'heic', 'dng', 'raw', 'cr2', 'nef', 'arw'
]

export function kindForExt(extWithoutDot: string): MediaKind {
  const e = extWithoutDot.toLowerCase()
  if (VIDEO_EXTS.includes(e)) return 'video'
  if (AUDIO_EXTS.includes(e)) return 'audio'
  if (IMAGE_EXTS.includes(e)) return 'image'
  return 'other'
}

// Category tags — kept in sync with cliprename.com.
export const CATEGORIES = [
  'outdoors', 'people', 'nature', 'urban', 'interior', 'product',
  'aerial', 'interview', 'broll', 'music', 'voice', 'sfx', 'screen', 'other'
] as const
export type Category = (typeof CATEGORIES)[number]

export type NamingStyle =
  | 'generic'
  | 'kebab-descriptive'
  | 'snake-descriptive'
  | 'title-spaces'
  | 'dated-kebab'
  | 'camera-scene'

export const NAMING_STYLES: { id: NamingStyle; label: string; hint: string }[] = [
  { id: 'kebab-descriptive', label: 'Dashes', hint: 'sunset-beach-walk' },
  { id: 'title-spaces', label: 'Spaces', hint: 'Sunset Beach Walk' },
  { id: 'snake-descriptive', label: 'Underscores', hint: 'sunset_beach_walk' },
  { id: 'dated-kebab', label: 'Add the date', hint: '2026-05-31-sunset-beach' }
]

export interface MediaItem {
  id: string
  path: string
  dir: string
  originalName: string // with extension
  baseName: string // without extension
  ext: string // without dot, lowercase
  kind: MediaKind
  sizeBytes: number
  mtimeMs: number
  // Filled after AI / sandbox analysis:
  suggestedName?: string // without extension
  category?: Category
  tags?: string[]
  description?: string // one-line "what's in this file", used by chat sorting
  actionGroup?: string // folder-friendly action category ("football", "cooking") from action naming
  status?: 'idle' | 'analyzing' | 'done' | 'error'
  error?: string
}

export interface ScanResult {
  root: string
  items: MediaItem[]
  counts: Record<MediaKind, number>
  totalBytes: number
}

export type ApplyMode = 'copy' | 'move'

export interface ApplyOptions {
  mode: ApplyMode
  outputDir: string
  organizeByCategory: boolean // /Video /Audio /Images sub-folders
}

// --- Folder Agent (in-place / new-folder renamer) ---
export type AgentMode = 'rename' | 'copy' | 'move'

export interface AgentRunOptions {
  mode: AgentMode
  // Destination folder name (created inside the chosen folder) for copy/move.
  subfolder: string
  // Sort clips into sub-folders named after their action ("football/", "cooking/").
  // Only meaningful for copy/move; rename-in-place never moves files.
  groupByAction?: boolean
}

// A single planned filesystem operation.
export interface PlanItem {
  id: string
  fromPath: string
  toRelPath: string // relative to outputDir, includes folders + final filename
  kind: MediaKind
}

export interface ApplyResult {
  journalId: string
  appliedCount: number
  errors: { from: string; message: string }[]
}

export interface JournalEntry {
  id: string
  createdAt: number
  mode: ApplyMode
  outputDir: string
  ops: { from: string; to: string }[]
}

// --- AI Chat Sorting ---
export interface SortAssignment {
  id: string // MediaItem id
  targetFolder: string // relative folder, '' = root
  suggestedName?: string // optional rename (without ext)
}

export interface SortOption {
  label: string
  description: string
  assignments: SortAssignment[]
}

export interface SortPlan {
  possible: boolean
  reason?: string // if not possible, plain-English why + closest doable suggestion
  message: string // assistant chat reply text
  options: SortOption[]
}

export interface AppSettings {
  style: NamingStyle
  defaultMode: ApplyMode
  organizeByCategory: boolean
  // Action-based video naming: sample several frames across each video and
  // name it by the primary action (e.g. "bicycle kick", "flipping pancakes").
  actionNaming: boolean
  welcomed: boolean // first-run welcome card dismissed
  lastFolder: string
  outputDir: string
  trayDir: string // where tray/clipped files are staged (any drive). '' = app default
}

export const DEFAULT_SETTINGS: AppSettings = {
  style: 'kebab-descriptive',
  defaultMode: 'copy',
  organizeByCategory: true,
  actionNaming: false,
  welcomed: false,
  lastFolder: '',
  outputDir: '',
  trayDir: ''
}

// --- NLE handoff (project-file export for editors) ---
// 'fcpxml' opens in Final Cut Pro AND DaVinci Resolve; 'premiere' is the
// Final Cut Pro 7 XML (<xmeml>) dialect that Premiere Pro imports.
export type NleTarget = 'fcpxml' | 'premiere'

export interface NleExportOptions {
  target: NleTarget
  // 'category' (broll/people/…) or 'action' (actionGroup like football/cooking).
  groupBy: 'category' | 'action'
  destPath: string // absolute path of the file to write
}

// --- Persistent library + search ---
export interface LibraryEntry {
  id: string // stable hash of the current path
  path: string
  name: string // final/suggested name without extension
  originalName: string
  ext: string
  kind: MediaKind
  category?: Category | string
  tags: string[]
  description: string
  sizeBytes: number
  mtimeMs: number
  contentHash?: string // size + partial-content hash, for duplicate detection
  addedAt: number // when it entered the library
}

export interface LibraryQuery {
  text?: string // matches name/original/tags/description/category
  kind?: MediaKind | 'all'
  category?: string
  limit?: number
}

// A set of files that look like the same content.
export interface DuplicateGroup {
  hash: string
  entries: LibraryEntry[]
  wastedBytes: number // total size of all-but-one copy
}

// --- Preset recipes ---
export interface Preset {
  id: string
  name: string
  style: NamingStyle
  organizeByCategory: boolean
  defaultMode: ApplyMode
  actionNaming: boolean
}

// --- Scene-out split ---
export interface SceneCut {
  index: number
  startSec: number
  endSec: number
}

export interface SceneSplitResult {
  outputDir: string
  clips: { path: string; startSec: number; endSec: number }[]
}

// --- In-app updates (fed by GitHub Releases) ---
export interface UpdateCheckResult {
  current: string
  latest: string
  available: boolean
  // true → the app can download + install itself (Windows). false → we hand
  // the user the right download instead (unsigned macOS can't self-replace).
  canSelfUpdate: boolean
  notes: string
  pageUrl: string
  downloadUrl?: string // direct asset for this machine (macOS .dmg)
  devMode?: boolean // running unpackaged — updates don't apply
  note?: string // plain-language reason the check couldn't complete
}

export interface UpdateProgress {
  percent?: number
  bps?: number
  ready?: boolean
  error?: string
}

// --- Watch-folder / scheduled automation ---
export interface WatchRule {
  id: string
  folder: string
  enabled: boolean
  // What to do with new media that lands in the folder.
  mode: AgentMode // 'rename' | 'copy' | 'move'
  subfolder: string // for copy/move
  style: NamingStyle
  createdAt: number
}

// One completed rename/copy/move done by a watch rule — persisted so the
// Automation tab can show "what changed in this folder" across app restarts.
export interface WatchHistoryEntry {
  ruleId: string
  folder: string
  oldName: string // original filename with extension
  newName: string // final filename with extension
  mode: AgentMode
  at: number
  // Set when the name did NOT come from the account AI (signed out, quota
  // exceeded, network down…) — the short human-readable reason why. Names
  // that consumed a plan credit have this unset.
  offline?: string
}

export interface WatchEvent {
  ruleId: string
  folder: string
  file: string
  newName: string
  at: number
  // found: a new file appeared · processing: naming it now · named: done ·
  // missed: the periodic sweep caught files the live watcher never reported.
  status: 'found' | 'processing' | 'named' | 'missed' | 'error'
  message?: string // human-readable line for the activity log
  error?: string
}

// What the Auto Clipper measured — lets the UI explain a "nothing found"
// honestly instead of leaving the user guessing.
export interface AutoClipAnalysis {
  mode: 'silence' | 'still'
  hasAudio: boolean
  maxDb: number
  thresholdDb: number
  deadCount: number
}

// --- Clipping / drag-out tray ---
export interface StageRequest {
  srcPath: string
  baseName: string
  ext: string
  kind: MediaKind
  startSec?: number
  endSec?: number
}

export interface EditImageRequest {
  srcPath: string
  baseName: string
  ext: string
  crop?: { x: number; y: number; w: number; h: number }
  rotate?: number
  flipH?: boolean
}

export interface TrayItem {
  id: string
  label: string // filename with extension
  stagedPath: string
  kind: MediaKind
  trimmed: boolean
}

export interface SuggestProgress {
  id: string
  index: number
  total: number
  status: MediaItem['status']
  suggestedName?: string
  category?: Category
  tags?: string[]
  description?: string
  actionGroup?: string
  error?: string
}
