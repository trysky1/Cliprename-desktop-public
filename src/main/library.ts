import Store from 'electron-store'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import {
  DuplicateGroup,
  LibraryEntry,
  LibraryQuery,
  MediaItem,
  ScanResult
} from '../shared/types'

// JSON-backed library (no native sqlite dep — keeps packaging painless). Holds
// every file the app has named/organized so users can search past projects and
// spot duplicates across folders.
const store = new Store<{ entries: LibraryEntry[] }>({
  name: 'cliprename-library',
  defaults: { entries: [] }
})

function idFor(p: string): string {
  return createHash('sha1').update(p).digest('hex').slice(0, 16)
}

// A fast, robust content fingerprint: file size + sampled head & tail bytes.
// Catches true duplicates (and re-encodes of identical sources) without reading
// gigabytes of video. Falls back to a size-only hash if the file can't be read.
export async function hashFile(p: string, sizeBytes: number): Promise<string> {
  const h = createHash('sha1')
  h.update(String(sizeBytes))
  const chunk = 65536
  try {
    const fd = await fs.open(p, 'r')
    try {
      const head = Buffer.alloc(chunk)
      const r1 = await fd.read(head, 0, chunk, 0)
      h.update(head.subarray(0, r1.bytesRead))
      if (sizeBytes > chunk) {
        const tail = Buffer.alloc(chunk)
        const start = Math.max(0, sizeBytes - chunk)
        const r2 = await fd.read(tail, 0, chunk, start)
        h.update(tail.subarray(0, r2.bytesRead))
      }
    } finally {
      await fd.close()
    }
  } catch {
    /* unreadable — size-only fingerprint */
  }
  return h.digest('hex')
}

function entryFromItem(item: MediaItem, prevAddedAt?: number, contentHash?: string): LibraryEntry {
  return {
    id: idFor(item.path),
    path: item.path,
    name: item.suggestedName || item.baseName,
    originalName: item.originalName,
    ext: item.ext,
    kind: item.kind,
    category: item.category,
    tags: item.tags ?? [],
    description: item.description ?? '',
    sizeBytes: item.sizeBytes,
    mtimeMs: item.mtimeMs,
    contentHash,
    addedAt: prevAddedAt ?? Date.now()
  }
}

export function getLibrary(): LibraryEntry[] {
  return store.get('entries')
}

// Upsert a batch of items into the library, computing a content hash for each.
// Returns how many were newly added (vs. updated in place).
export async function addToLibrary(items: MediaItem[]): Promise<{ added: number; total: number }> {
  const existing = store.get('entries')
  const byId = new Map(existing.map((e) => [e.id, e]))
  let added = 0
  for (const it of items) {
    const id = idFor(it.path)
    const prev = byId.get(id)
    const contentHash = await hashFile(it.path, it.sizeBytes).catch(() => prev?.contentHash)
    if (!prev) added++
    byId.set(id, entryFromItem(it, prev?.addedAt, contentHash))
  }
  const next = Array.from(byId.values())
  store.set('entries', next)
  return { added, total: next.length }
}

export function searchLibrary(q: LibraryQuery): LibraryEntry[] {
  let res = store.get('entries')
  if (q.kind && q.kind !== 'all') res = res.filter((e) => e.kind === q.kind)
  if (q.category) res = res.filter((e) => String(e.category ?? '') === q.category)
  if (q.text && q.text.trim()) {
    const terms = q.text.toLowerCase().split(/\s+/).filter(Boolean)
    res = res.filter((e) => {
      const hay = [
        e.name,
        e.originalName,
        e.description,
        String(e.category ?? ''),
        ...(e.tags ?? [])
      ]
        .join(' ')
        .toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
  }
  res = res.slice().sort((a, b) => b.addedAt - a.addedAt)
  return q.limit ? res.slice(0, q.limit) : res
}

// Group library entries that share a content fingerprint (i.e. duplicates).
export function findDuplicates(): DuplicateGroup[] {
  const groups = new Map<string, LibraryEntry[]>()
  for (const e of store.get('entries')) {
    if (!e.contentHash) continue
    const arr = groups.get(e.contentHash) ?? []
    arr.push(e)
    groups.set(e.contentHash, arr)
  }
  const out: DuplicateGroup[] = []
  for (const [hash, entries] of groups) {
    if (entries.length < 2) continue
    // Keep one copy; the rest are "wasted" space.
    const sorted = entries.slice().sort((a, b) => a.addedAt - b.addedAt)
    const wastedBytes = sorted.slice(1).reduce((s, e) => s + e.sizeBytes, 0)
    out.push({ hash, entries: sorted, wastedBytes })
  }
  return out.sort((a, b) => b.wastedBytes - a.wastedBytes)
}

export function removeFromLibrary(ids: string[]): number {
  const drop = new Set(ids)
  const kept = store.get('entries').filter((e) => !drop.has(e.id))
  store.set('entries', kept)
  return kept.length
}

export function clearLibrary(): void {
  store.set('entries', [])
}

// Index an already-scanned folder result into the library (used by the
// "find duplicates in this folder" flow — no renaming required).
export async function indexScan(scan: ScanResult): Promise<{ added: number; total: number }> {
  return addToLibrary(scan.items)
}
