import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import {
  AgentRunOptions,
  ApplyMode,
  ApplyOptions,
  ApplyResult,
  JournalEntry,
  MediaItem,
  MediaKind,
  PlanItem,
  ScanResult,
  SortAssignment,
  kindForExt
} from '../shared/types'

const IGNORE_DIRS = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information'])
const IGNORE_FILES = new Set(['thumbs.db', 'desktop.ini', '.ds_store'])
const MAX_FILES = 5000

function idForPath(p: string): string {
  let h = 0
  for (let i = 0; i < p.length; i++) h = (Math.imul(31, h) + p.charCodeAt(i)) | 0
  return 'f' + Math.abs(h).toString(36)
}

interface Acc {
  items: MediaItem[]
  counts: Record<MediaKind, number>
  totalBytes: number
  seen: Set<string>
}

function newAcc(): Acc {
  return {
    items: [],
    counts: { video: 0, audio: 0, image: 0, other: 0 },
    totalBytes: 0,
    seen: new Set()
  }
}

// `explicit` = the user picked/dropped this exact file, so honor it even if it
// looks hidden. During recursive folder walks we still skip dotfiles & junk.
async function addFile(acc: Acc, full: string, name: string, explicit = false): Promise<void> {
  if (!explicit) {
    if (name.startsWith('.')) return
    if (IGNORE_FILES.has(name.toLowerCase())) return
  }
  const id = idForPath(full)
  if (acc.seen.has(id)) return // de-dupe (e.g. folder + explicit file overlap)
  acc.seen.add(id)
  const ext = path.extname(name).slice(1).toLowerCase()
  const kind = kindForExt(ext) // includes 'other' — we sort anything
  let size = 0
  let mtimeMs = 0
  try {
    const st = await fs.stat(full)
    size = st.size
    mtimeMs = st.mtimeMs
  } catch {
    /* ignore */
  }
  acc.counts[kind]++
  acc.totalBytes += size
  acc.items.push({
    id,
    path: full,
    dir: path.dirname(full),
    originalName: name,
    baseName: name.slice(0, name.length - (ext ? ext.length + 1 : 0)),
    ext,
    kind,
    sizeBytes: size,
    mtimeMs,
    status: 'idle'
  })
}

async function walk(acc: Acc, dir: string): Promise<void> {
  if (acc.items.length >= MAX_FILES) return
  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (acc.items.length >= MAX_FILES) return
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      await walk(acc, full)
    } else if (entry.isFile()) {
      await addFile(acc, full, entry.name)
    }
  }
}

function finalize(acc: Acc, root: string): ScanResult {
  acc.items.sort((a, b) => a.originalName.localeCompare(b.originalName))
  return { root, items: acc.items, counts: acc.counts, totalBytes: acc.totalBytes }
}

export async function scanFolder(root: string): Promise<ScanResult> {
  const acc = newAcc()
  await walk(acc, root)
  return finalize(acc, root)
}

// Recursive scan of a single folder, narrowed to ONLY video + audio.
// Used by the Folder Agent (in-place renamer) — images & other files are
// intentionally excluded so they can never be touched.
export async function scanAgent(root: string): Promise<ScanResult> {
  const acc = newAcc()
  await walk(acc, root)
  const items = acc.items.filter((i) => i.kind === 'video' || i.kind === 'audio')
  const counts: Record<MediaKind, number> = { video: 0, audio: 0, image: 0, other: 0 }
  let totalBytes = 0
  for (const it of items) {
    counts[it.kind]++
    totalBytes += it.sizeBytes
  }
  items.sort((a, b) => a.path.localeCompare(b.path))
  return { root, items, counts, totalBytes }
}

// Scan a mix of files and/or folders (from a multi-select picker or drag-drop).
export async function scanPaths(paths: string[]): Promise<ScanResult> {
  const acc = newAcc()
  let root = ''
  for (const p of paths) {
    try {
      const st = await fs.stat(p)
      if (st.isDirectory()) {
        if (!root) root = p
        await walk(acc, p)
      } else if (st.isFile()) {
        if (!root) root = path.dirname(p)
        let full = p
        let name = path.basename(p)
        // macOS AppleDouble: "._Clip.mp4" is a 4KB metadata stub, not media.
        // If the user picked one (they sort next to the real file), use the
        // real sibling "Clip.mp4" instead so their choice actually works.
        if (name.startsWith('._')) {
          const sibling = path.join(path.dirname(p), name.slice(2))
          try {
            await fs.access(sibling)
            full = sibling
            name = name.slice(2)
          } catch {
            continue // no real sibling — it's pure junk, skip it
          }
        }
        await addFile(acc, full, name, true) // explicit pick → honor it
      }
    } catch {
      /* skip unreadable path */
    }
  }
  return finalize(acc, root || (paths[0] ? path.dirname(paths[0]) : ''))
}

function kindFolder(kind: MediaKind): string {
  return kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : kind === 'image' ? 'Images' : 'Other'
}

// Strip only filesystem-illegal characters; keep spaces, hyphens, underscores.
const ILLEGAL = /[<>:"/\\|?*]/g
function sanitizeSegment(s: string): string {
  return s.replace(ILLEGAL, '').replace(/\s+/g, ' ').replace(/\.+$/, '').trim() || 'untitled'
}

// Standard rename plan: optional category sub-folders.
export function buildPlan(items: MediaItem[], options: ApplyOptions): PlanItem[] {
  return items.map((item) => {
    const base = sanitizeSegment(item.suggestedName || item.baseName)
    const fileName = `${base}.${item.ext}`
    const rel = options.organizeByCategory ? path.join(kindFolder(item.kind), fileName) : fileName
    return { id: item.id, fromPath: item.path, toRelPath: rel, kind: item.kind }
  })
}

// Chat-sort plan: explicit target folder + optional rename per assignment.
export function buildPlanFromAssignments(
  items: MediaItem[],
  assignments: SortAssignment[]
): PlanItem[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  const plan: PlanItem[] = []
  for (const a of assignments) {
    const item = byId.get(a.id)
    if (!item) continue
    // Empty target folder means "(stays in place)" in the UI — honor that
    // instead of relocating the file to the output-dir root.
    if (!(a.targetFolder || '').trim()) continue
    const base = sanitizeSegment(a.suggestedName || item.suggestedName || item.baseName)
    const fileName = `${base}.${item.ext}`
    const folder = (a.targetFolder || '')
      .split(/[/\\]/)
      .map((seg) => sanitizeSegment(seg))
      .filter(Boolean)
      .join(path.sep)
    const rel = folder ? path.join(folder, fileName) : fileName
    plan.push({ id: item.id, fromPath: item.path, toRelPath: rel, kind: item.kind })
  }
  return plan
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

// Never overwrite: append -1, -2, ... before the extension.
async function uniqueTarget(target: string): Promise<string> {
  if (!(await exists(target))) return target
  const dir = path.dirname(target)
  const ext = path.extname(target)
  const base = path.basename(target, ext)
  let n = 1
  while (true) {
    const candidate = path.join(dir, `${base}-${n}${ext}`)
    if (!(await exists(candidate))) return candidate
    n++
  }
}

function journalsDir(): string {
  return path.join(app.getPath('userData'), 'journals')
}

// Persist an operation journal so any apply/rename can be reversed with undoJournal.
async function writeJournal(
  ops: { from: string; to: string }[],
  mode: ApplyMode,
  outputDir: string
): Promise<JournalEntry> {
  const journal: JournalEntry = {
    id: 'j' + Date.now().toString(36),
    createdAt: Date.now(),
    mode,
    outputDir,
    ops
  }
  await fs.mkdir(journalsDir(), { recursive: true })
  await fs.writeFile(path.join(journalsDir(), `${journal.id}.json`), JSON.stringify(journal, null, 2))
  return journal
}

export async function applyPlan(plan: PlanItem[], options: ApplyOptions): Promise<ApplyResult> {
  const errors: { from: string; message: string }[] = []
  const ops: { from: string; to: string }[] = []

  await fs.mkdir(options.outputDir, { recursive: true })

  for (const p of plan) {
    try {
      const intended = path.join(options.outputDir, p.toRelPath)
      // Re-applying an unchanged plan must be a no-op: check "already at
      // destination" BEFORE uniqueTarget, or the file would collide with
      // itself and get renamed to a pointless "name-1" duplicate.
      if (path.resolve(intended) === path.resolve(p.fromPath)) {
        continue // source already at destination
      }
      const target = await uniqueTarget(intended)
      await fs.mkdir(path.dirname(target), { recursive: true })
      if (options.mode === 'move') {
        try {
          await fs.rename(p.fromPath, target)
        } catch (e) {
          // Only EXDEV (cross-device) warrants the copy+unlink fallback —
          // anything else (permissions, locks) must surface as an error.
          if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
          await fs.copyFile(p.fromPath, target)
          try {
            await fs.unlink(p.fromPath)
          } catch (unlinkErr) {
            // Source couldn't be removed: delete the fresh copy so we don't
            // leave an unjournaled duplicate behind.
            await fs.unlink(target).catch(() => {})
            throw unlinkErr
          }
        }
      } else {
        await fs.copyFile(p.fromPath, target)
      }
      ops.push({ from: p.fromPath, to: target })
    } catch (e) {
      errors.push({ from: p.fromPath, message: e instanceof Error ? e.message : String(e) })
    }
  }

  const journal = await writeJournal(ops, options.mode, options.outputDir)
  return { journalId: journal.id, appliedCount: ops.length, errors }
}

// ---- Folder Agent: rename video/audio in place, where they sit ----
// Each file is renamed inside its OWN directory (never moved between folders).
// Reuses the move-mode journal so undoJournal reverses it unchanged.
export async function renameInPlace(items: MediaItem[]): Promise<ApplyResult> {
  const errors: { from: string; message: string }[] = []
  const ops: { from: string; to: string }[] = []
  let root = ''

  for (const item of items) {
    // Defense-in-depth: only ever touch video & audio, even if a bad item slips through.
    if (item.kind !== 'video' && item.kind !== 'audio') continue
    if (!item.suggestedName) continue

    const from = item.path
    if (!root) root = path.dirname(from)
    const dir = path.dirname(from)
    const ext = item.ext
    const newBase = sanitizeSegment(item.suggestedName)
    const newName = ext ? `${newBase}.${ext}` : newBase
    const currentName = path.basename(from)

    // No-op: name already matches exactly (nothing to do, keeps the journal clean).
    if (newName === currentName) continue

    try {
      const desired = path.join(dir, newName)
      const sameFileDifferentCase =
        path.resolve(desired).toLowerCase() === path.resolve(from).toLowerCase()

      // Case-only rename (clip.mp4 -> Clip.mp4): rename directly. On a
      // case-insensitive FS uniqueTarget would see "itself" and add a "-1".
      const target = sameFileDifferentCase ? desired : await uniqueTarget(desired)

      if (path.resolve(target) === path.resolve(from)) continue

      try {
        await fs.rename(from, target)
      } catch (e) {
        // cross-device fallback (shouldn't happen in-place, but mirror applyPlan)
        if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
        await fs.copyFile(from, target)
        try {
          await fs.unlink(from)
        } catch (unlinkErr) {
          // Source couldn't be removed: delete the fresh copy so we don't
          // leave an unjournaled duplicate behind.
          await fs.unlink(target).catch(() => {})
          throw unlinkErr
        }
      }
      ops.push({ from, to: target })
    } catch (e) {
      errors.push({ from, message: e instanceof Error ? e.message : String(e) })
    }
  }

  const journal = await writeJournal(ops, 'move', root)
  return { journalId: journal.id, appliedCount: ops.length, errors }
}

// Folder Agent entry point. Three behaviours, all journaled + undoable:
//  - 'rename': rename the originals in place (renameInPlace).
//  - 'copy':  keep originals untouched; place renamed copies in a new
//             subfolder inside the chosen folder.
//  - 'move':  rename + gather the files into that new subfolder (originals
//             removed from their original spot).
// Only video/audio are ever processed.
export async function runAgent(
  root: string,
  items: MediaItem[],
  options: AgentRunOptions
): Promise<ApplyResult> {
  const media = items.filter(
    (i) => (i.kind === 'video' || i.kind === 'audio') && !!i.suggestedName
  )
  if (options.mode === 'rename') return renameInPlace(media)

  const folderName = sanitizeSegment(options.subfolder || 'Renamed')
  const outDir = path.join(root, folderName)
  const plan: PlanItem[] = media.map((item) => {
    const base = sanitizeSegment(item.suggestedName as string)
    const fileName = item.ext ? `${base}.${item.ext}` : base
    // Action sort: bucket each clip into a folder named after its activity.
    // Clips without a detected group (audio, sandbox runs) land in "other-clips"
    // so nothing gets mixed in flat or lost.
    const group = options.groupByAction
      ? sanitizeSegment((item.actionGroup || 'other-clips').toLowerCase())
      : ''
    return {
      id: item.id,
      fromPath: item.path,
      toRelPath: group ? path.join(group, fileName) : fileName,
      kind: item.kind
    }
  })
  return applyPlan(plan, {
    mode: options.mode === 'move' ? 'move' : 'copy',
    outputDir: outDir,
    organizeByCategory: false
  })
}

export async function listJournals(): Promise<JournalEntry[]> {
  try {
    const files = await fs.readdir(journalsDir())
    const entries: JournalEntry[] = []
    for (const f of files.filter((x) => x.endsWith('.json'))) {
      try {
        entries.push(JSON.parse(await fs.readFile(path.join(journalsDir(), f), 'utf-8')))
      } catch {
        /* ignore */
      }
    }
    return entries.sort((a, b) => b.createdAt - a.createdAt).slice(0, 25)
  } catch {
    return []
  }
}

export async function undoJournal(journalId: string): Promise<{ undone: number; errors: string[] }> {
  const file = path.join(journalsDir(), `${journalId}.json`)
  let journal: JournalEntry
  try {
    journal = JSON.parse(await fs.readFile(file, 'utf-8'))
  } catch {
    return { undone: 0, errors: ['Journal not found.'] }
  }
  const errors: string[] = []
  const failed = new Set<{ from: string; to: string }>()
  let undone = 0
  for (const op of [...journal.ops].reverse()) {
    try {
      if (journal.mode === 'move') {
        await fs.mkdir(path.dirname(op.from), { recursive: true })
        await fs.rename(op.to, op.from).catch(async () => {
          await fs.copyFile(op.to, op.from)
          await fs.unlink(op.to)
        })
      } else {
        await fs.unlink(op.to) // copy mode: delete the copy we created
      }
      undone++
    } catch (e) {
      failed.add(op)
      errors.push(`${op.to}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (errors.length === 0) {
    await fs.unlink(file).catch(() => {})
  } else {
    // Some ops failed — keep the journal with ONLY the failed ops so the undo
    // can be retried later, instead of losing the trail entirely.
    const remaining: JournalEntry = { ...journal, ops: journal.ops.filter((op) => failed.has(op)) }
    await fs.writeFile(file, JSON.stringify(remaining, null, 2)).catch(() => {})
  }
  return { undone, errors }
}
