import React, { useEffect, useState } from 'react'
import { DuplicateGroup, LibraryEntry, MediaKind } from '../../shared/types'
import { formatBytes } from '../lib/format'
import MediaThumb from './MediaThumb'

type Tab = 'search' | 'duplicates'
const KINDS: { id: MediaKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'image', label: 'Images' }
]

// Persistent library + search across every file the app has ever named, plus
// content-hash duplicate detection across folders.
export default function LibraryPanel(): React.ReactElement {
  const [tab, setTab] = useState<Tab>('search')
  const [text, setText] = useState('')
  const [kind, setKind] = useState<MediaKind | 'all'>('all')
  const [results, setResults] = useState<LibraryEntry[]>([])
  const [total, setTotal] = useState(0)
  const [dupes, setDupes] = useState<DuplicateGroup[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function runSearch(): Promise<void> {
    const res = await window.api.librarySearch({ text, kind, limit: 500 })
    setResults(res)
  }

  async function refreshTotal(): Promise<void> {
    const all = await window.api.libraryAll()
    setTotal(all.length)
  }

  useEffect(() => {
    refreshTotal()
    runSearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    runSearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, kind])

  async function addFolder(): Promise<void> {
    const p = await window.api.pickFolder()
    if (!p) return
    setBusy(true)
    setMsg('')
    try {
      const res = await window.api.libraryIndexFolder(p)
      setMsg(`Added ${res.added} new files — ${res.total} in your library.`)
      await refreshTotal()
      await runSearch()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function scanDuplicates(): Promise<void> {
    setBusy(true)
    try {
      setDupes(await window.api.libraryDuplicates())
    } finally {
      setBusy(false)
    }
  }

  async function removeEntry(id: string): Promise<void> {
    await window.api.libraryRemove([id])
    await refreshTotal()
    if (tab === 'duplicates') await scanDuplicates()
    else await runSearch()
  }

  // "Show" is honest about stale entries: the library remembers where a file
  // WAS, but it may have been renamed or moved since.
  async function revealEntry(p: string): Promise<void> {
    const r = await window.api.reveal(p)
    if (!r.ok) {
      setMsg('That file (and its folder) isn’t there anymore — it was moved or deleted. You can remove it from the library.')
    } else if (r.openedFolder) {
      setMsg('That exact file has been renamed or moved since — opened the folder it used to live in.')
    } else {
      setMsg('')
    }
  }

  async function clearAll(): Promise<void> {
    await window.api.libraryClear()
    setResults([])
    setDupes(null)
    setTotal(0)
  }

  const wastedTotal = (dupes ?? []).reduce((s, g) => s + g.wastedBytes, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-xl border border-border bg-surface p-1">
          <button
            onClick={() => setTab('search')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === 'search' ? 'bg-mint text-mint-ink' : 'text-muted'}`}
          >
            Search
          </button>
          <button
            onClick={() => setTab('duplicates')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === 'duplicates' ? 'bg-mint text-mint-ink' : 'text-muted'}`}
          >
            Find duplicates
          </button>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-faint">
          <span>{total.toLocaleString()} files indexed</span>
          <button onClick={addFolder} disabled={busy} className="btn !py-1.5 !px-3 text-xs">
            + Add a folder
          </button>
          {total > 0 && (
            <button onClick={clearAll} className="btn-ghost !py-1.5 !px-2 text-xs">
              Clear
            </button>
          )}
        </div>
      </div>

      {msg && <div className="text-[12px] text-mint">{msg}</div>}

      {tab === 'search' ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Search names, tags, descriptions…"
              className="field flex-1 min-w-[200px]"
            />
            <div className="inline-flex rounded-lg border border-borderSoft bg-surface2 p-0.5">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  onClick={() => setKind(k.id)}
                  className={`rounded-md px-2.5 py-1 text-xs ${kind === k.id ? 'bg-mint text-mint-ink' : 'text-muted'}`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          {total === 0 ? (
            <Empty text="Your library is empty. Name some files, or add a folder to index it for search & duplicate detection." />
          ) : results.length === 0 ? (
            <Empty text="No matches. Try a different word." />
          ) : (
            <div className="max-h-[52vh] space-y-1.5 overflow-auto pr-1">
              {results.map((e) => (
                <Row key={e.id} e={e} onReveal={() => revealEntry(e.path)} onRemove={() => removeEntry(e.id)} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={scanDuplicates} disabled={busy || total === 0} className="btn-primary">
              {busy ? 'Scanning…' : 'Scan library for duplicates'}
            </button>
            {dupes && (
              <span className="text-xs text-faint">
                {dupes.length} duplicate {dupes.length === 1 ? 'set' : 'sets'} ·{' '}
                <span className="text-peach">{formatBytes(wastedTotal)}</span> could be freed if you delete the extra copies yourself
              </span>
            )}
          </div>

          {dupes && dupes.length === 0 && <Empty text="No duplicates found — your library is clean." />}
          {dupes && dupes.length > 0 && (
            <div className="max-h-[52vh] space-y-3 overflow-auto pr-1">
              {dupes.map((g) => (
                <div key={g.hash} className="rounded-xl border border-borderSoft bg-surface2/60 p-3">
                  <div className="mb-2 text-[11px] text-faint">
                    {g.entries.length} copies · {formatBytes(g.wastedBytes)} of duplicates
                  </div>
                  <div className="space-y-1.5">
                    {g.entries.map((e, i) => (
                      <div key={e.id} className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2">
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            i === 0 ? 'bg-mint/15 text-mint' : 'bg-peach/15 text-peach'
                          }`}
                        >
                          {i === 0 ? 'keep' : 'dupe'}
                        </span>
                        <MediaThumb path={e.path} kind={e.kind} className="h-9 w-11 rounded-md" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] text-text">{e.name}.{e.ext}</div>
                          <div className="truncate font-mono text-[10px] text-faint" title={e.path}>
                            {e.path}
                          </div>
                        </div>
                        <button onClick={() => revealEntry(e.path)} className="btn-ghost !py-1 !px-2 text-[11px]">
                          Show
                        </button>
                        {i > 0 && (
                          <button onClick={() => removeEntry(e.id)} className="btn !py-1 !px-2 text-[11px]">
                            Forget
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Row({
  e,
  onReveal,
  onRemove
}: {
  e: LibraryEntry
  onReveal: () => void
  onRemove: () => void
}): React.ReactElement {
  return (
    <div
      onDoubleClick={() => window.api.openPath(e.path)}
      title="Double-click to open"
      className="flex cursor-default items-center gap-3 rounded-xl border border-borderSoft bg-surface px-3 py-2"
    >
      <MediaThumb path={e.path} kind={e.kind} className="h-10 w-12 rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-text">{e.name}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-[10px] text-faint">
          {e.category && <span className="text-mint/80">{String(e.category)}</span>}
          {(e.tags ?? []).slice(0, 3).map((t) => (
            <span key={t}>#{t}</span>
          ))}
          <span>{formatBytes(e.sizeBytes)}</span>
        </div>
      </div>
      <button onClick={onReveal} className="btn-ghost !py-1 !px-2 text-[11px]">
        Show
      </button>
      <button onClick={onRemove} className="btn-ghost !py-1 !px-2 text-[11px]" title="Remove from library">
        ✕
      </button>
    </div>
  )
}

function Empty({ text }: { text: string }): React.ReactElement {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface2/40 px-6 py-10 text-center text-sm text-faint">
      {text}
    </div>
  )
}
