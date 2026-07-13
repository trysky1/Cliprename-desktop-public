import React, { useEffect, useState } from 'react'
import {
  AgentMode,
  NamingStyle,
  NAMING_STYLES,
  WatchEvent,
  WatchHistoryEntry,
  WatchRule
} from '../../shared/types'
import MediaThumb from './MediaThumb'

const MODES: { id: AgentMode; label: string; hint: string }[] = [
  { id: 'rename', label: 'Rename in place', hint: 'Rename new files where they land' },
  { id: 'copy', label: 'Copy to subfolder', hint: 'Keep originals, copy renamed into a subfolder' },
  { id: 'move', label: 'Move to subfolder', hint: 'Rename and move into a subfolder' }
]

function newId(): string {
  return 'wr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function timeOf(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// History spans days, so show the date too — but keep today's entries short.
function whenOf(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
  if (d.toDateString() === now.toDateString()) return hm
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${hm}`
}

// Automation runs in the background while the user is on OTHER tabs — so the
// event stream is buffered at module level (subscribed once, app-lifetime).
// Opening the Automation tab then shows everything that happened, not just
// events that arrive while the panel is mounted.
const eventBuffer: WatchEvent[] = []
const bufferListeners = new Set<(evs: WatchEvent[]) => void>()
window.api.onAutomationEvent((ev) => {
  eventBuffer.unshift(ev)
  if (eventBuffer.length > 60) eventBuffer.length = 60
  for (const l of bufferListeners) l([...eventBuffer])
})

// Watch-folder automation: point it at an import/Downloads folder and new media
// is auto-named & filed the moment it arrives, using the signed-in AI pipeline.
export default function AutomationPanel(): React.ReactElement {
  const [rules, setRules] = useState<WatchRule[]>([])
  const [events, setEvents] = useState<WatchEvent[]>([])
  // Persisted rename history (survives restarts) + which rule rows are expanded.
  const [history, setHistory] = useState<WatchHistoryEntry[]>([])
  const [openRules, setOpenRules] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [draftFolder, setDraftFolder] = useState('')
  const [draftMode, setDraftMode] = useState<AgentMode>('copy')
  const [draftSub, setDraftSub] = useState('Renamed')
  const [draftStyle, setDraftStyle] = useState<NamingStyle>('kebab-descriptive')
  // Clips already sitting in the chosen folder: how many, and whether the
  // user wants them renamed too (watchers only touch NEW arrivals by default).
  const [existingCount, setExistingCount] = useState(0)
  const [alsoExisting, setAlsoExisting] = useState(false)

  useEffect(() => {
    window.api.watchAll().then(setRules)
    void window.api.watchHistory().then(setHistory)
    setEvents([...eventBuffer]) // everything that happened while on other tabs
    bufferListeners.add(setEvents)
    return () => {
      bufferListeners.delete(setEvents)
    }
  }, [])

  // A new 'named' event means the persisted history just grew — refresh it so
  // the per-folder dropdown always matches what actually changed on disk.
  const namedCount = events.filter((e) => e.status === 'named').length
  useEffect(() => {
    if (namedCount > 0) void window.api.watchHistory().then(setHistory)
  }, [namedCount])

  // Session counters derived from the event stream: how many files each rule
  // finished, and which rules are mid-processing right now.
  const doneCount = new Map<string, number>()
  const busyRules = new Set<string>()
  const settled = new Set<string>()
  for (const ev of events) {
    if (ev.status === 'named') doneCount.set(ev.ruleId, (doneCount.get(ev.ruleId) ?? 0) + 1)
    // events arrive newest-first: a 'processing' only counts as busy if no
    // later named/error event settled that same file.
    const key = ev.ruleId + '|' + ev.file
    if (ev.status === 'named' || ev.status === 'error') settled.add(key)
    if (ev.status === 'processing' && !settled.has(key)) busyRules.add(ev.ruleId)
  }

  async function pickDraftFolder(): Promise<void> {
    const p = await window.api.pickFolder()
    if (p) {
      setDraftFolder(p)
      setAlsoExisting(false)
      setExistingCount(await window.api.watchExistingCount(p).catch(() => 0))
    }
  }

  async function saveDraft(): Promise<void> {
    if (!draftFolder) return
    const rule: WatchRule = {
      id: newId(),
      folder: draftFolder,
      enabled: true,
      mode: draftMode,
      subfolder: draftSub.trim() || 'Renamed',
      style: draftStyle,
      createdAt: Date.now()
    }
    setRules(await window.api.watchSave(rule))
    // One-time pass over what was already in the folder — only if asked.
    // Progress streams into the same live-activity feed as new arrivals.
    if (alsoExisting && existingCount > 0) void window.api.watchProcessExisting(rule.id)
    setAdding(false)
    setDraftFolder('')
    setDraftSub('Renamed')
    setExistingCount(0)
    setAlsoExisting(false)
  }

  async function toggle(rule: WatchRule): Promise<void> {
    setRules(await window.api.watchSave({ ...rule, enabled: !rule.enabled }))
  }

  async function remove(id: string): Promise<void> {
    setRules(await window.api.watchDelete(id))
    setHistory(await window.api.watchHistory())
  }

  function toggleOpen(id: string): void {
    setOpenRules((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-borderSoft bg-surface2/60 px-4 py-3 text-[12px] text-muted">
        Point ClipRename at a folder — your camera-import drive, Downloads, a render
        output — and every new video, audio, or image that lands gets named and filed
        automatically, in the background. Each file the AI names uses 1 credit from
        your plan, the same as naming it by hand.
      </div>

      <div className="flex items-center justify-between">
        <div className="section-title">Watched folders</div>
        {!adding && (
          <button onClick={() => setAdding(true)} className="btn !py-1.5 !px-3 text-xs">
            + Watch a folder
          </button>
        )}
      </div>

      {adding && (
        <div className="space-y-3 rounded-xl border border-mint/30 bg-mint/5 p-4">
          <div className="flex items-center gap-2">
            <button onClick={pickDraftFolder} className="btn !py-1.5 text-xs">
              Choose folder…
            </button>
            <span className="truncate font-mono text-[11px] text-faint">{draftFolder || 'No folder chosen'}</span>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setDraftMode(m.id)}
                aria-pressed={draftMode === m.id}
                className={`rounded-xl border px-3 py-2 text-left transition-all ${
                  draftMode === m.id ? 'border-mint bg-mint/10' : 'border-borderSoft bg-surface2 hover:border-faint'
                }`}
              >
                <div className={`text-[12px] font-medium ${draftMode === m.id ? 'text-mint' : 'text-text'}`}>
                  {m.label}
                </div>
                <div className="mt-0.5 text-[10px] leading-snug text-faint">{m.hint}</div>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {draftMode !== 'rename' && (
              <label className="flex items-center gap-2 text-xs text-muted">
                Subfolder
                <input
                  value={draftSub}
                  onChange={(e) => setDraftSub(e.target.value)}
                  className="field !py-1.5 max-w-[160px] font-mono text-xs"
                />
              </label>
            )}
            <label className="flex items-center gap-2 text-xs text-muted">
              Style
              <select
                value={draftStyle}
                onChange={(e) => setDraftStyle(e.target.value as NamingStyle)}
                className="field !py-1.5 text-xs"
              >
                {NAMING_STYLES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} — {s.hint}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {draftFolder && existingCount === 0 && (
            <div className="rounded-lg border border-borderSoft bg-surface px-3 py-2.5 text-[12px] text-muted">
              No clips at the top level of this folder yet — new clips that land here get renamed
              automatically. <span className="text-faint">Heads-up: clips inside subfolders aren’t
              watched; move them to the top level if you want them renamed.</span>
            </div>
          )}
          {existingCount > 0 && (
            <div className="space-y-1.5 rounded-lg border border-borderSoft bg-surface px-3 py-2.5">
              <label className="flex cursor-pointer items-start gap-2 text-[12px] text-text">
                <input
                  type="checkbox"
                  checked={alsoExisting}
                  onChange={(e) => setAlsoExisting(e.target.checked)}
                  className="mt-0.5 accent-mint"
                />
                <span>
                  This folder already has <b>{existingCount}</b> clip
                  {existingCount === 1 ? '' : 's'} — rename {existingCount === 1 ? 'it' : 'them'}{' '}
                  too when I start watching{' '}
                  <span className="text-faint">
                    (uses {existingCount} credit{existingCount === 1 ? '' : 's'})
                  </span>
                </span>
              </label>
              {alsoExisting && (
                <div className="rounded-md border border-peach/30 bg-peach/5 px-2.5 py-2 text-[11px] leading-relaxed text-peach">
                  Heads-up: if a video editor project (Premiere, Resolve, Final Cut…) already
                  uses these clips, renaming or moving them breaks the project’s media links.
                  {draftMode === 'rename' ? (
                    <>
                      {' '}
                      Safer: pick <b>Copy to subfolder</b> above — the renamed clips land in a
                      separate editing folder and the originals stay exactly where your editor
                      expects them.
                    </>
                  ) : (
                    <>
                      {' '}
                      You’re safe with <b>{draftMode === 'copy' ? 'Copy' : 'Move'} to subfolder</b>
                      {draftMode === 'copy'
                        ? ' — originals stay untouched; the renamed copies land in their own editing folder, ready to cut from.'
                        : ' — but Move still takes the originals away from where the editor saved them. Copy is the risk-free choice.'}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button onClick={saveDraft} disabled={!draftFolder} className="btn-primary !py-2 text-xs">
              Start watching
            </button>
            <button onClick={() => setAdding(false)} className="btn-ghost !py-2 text-xs">
              Cancel
            </button>
          </div>
        </div>
      )}

      {rules.length === 0 && !adding ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface2/40 px-6 py-8 text-center text-sm text-faint">
          No watched folders yet.
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => {
            const changes = history.filter((h) => h.ruleId === r.id).slice().reverse() // newest first
            const open = openRules.has(r.id)
            return (
              <div key={r.id} className="rounded-xl border border-borderSoft bg-surface">
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <button
                    onClick={() => toggle(r)}
                    title={r.enabled ? 'Watching — click to pause' : 'Paused — click to resume'}
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${r.enabled ? 'bg-mint' : 'bg-faint'}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-text">{r.folder}</div>
                    <div className="text-[10px] text-faint">
                      {r.mode === 'rename' ? 'Rename in place' : `${r.mode} → ${r.subfolder}`} · {NAMING_STYLES.find((s) => s.id === r.style)?.label ?? r.style}
                      {' · '}
                      <span className={r.enabled ? 'text-mint' : 'text-faint'}>
                        {!r.enabled
                          ? 'paused'
                          : busyRules.has(r.id)
                            ? 'processing…'
                            : 'watching'}
                      </span>
                      {(doneCount.get(r.id) ?? 0) > 0 && (
                        <span className="text-mint"> · {doneCount.get(r.id)} processed</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => toggleOpen(r.id)}
                    aria-expanded={open}
                    className="btn-ghost !py-1 !px-2 text-[11px]"
                    title="Show every file this folder rule renamed"
                  >
                    {open ? '▾' : '▸'}{' '}
                    {changes.length > 0 ? `${changes.length} renamed` : 'details'}
                  </button>
                  <button
                    onClick={() => window.api.openPath(r.folder)}
                    className="btn-ghost !py-1 !px-2 text-[11px]"
                    title="Open this folder to browse the clips yourself"
                  >
                    Open
                  </button>
                  <button onClick={() => toggle(r)} className="btn-ghost !py-1 !px-2 text-[11px]">
                    {r.enabled ? 'Pause' : 'Resume'}
                  </button>
                  <button onClick={() => remove(r.id)} className="btn-ghost !py-1 !px-2 text-[11px]">
                    ✕
                  </button>
                </div>

                {open && (
                  <div className="border-t border-borderSoft px-3 py-2">
                    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                      <span>
                        <span className="text-faint">Does:</span>{' '}
                        {r.mode === 'rename'
                          ? 'renames new files where they land'
                          : r.mode === 'copy'
                            ? `copies renamed files into “${r.subfolder}”`
                            : `moves renamed files into “${r.subfolder}”`}
                      </span>
                      <span>
                        <span className="text-faint">Style:</span> {NAMING_STYLES.find((s) => s.id === r.style)?.label ?? r.style}
                      </span>
                      <span>
                        <span className="text-faint">Since:</span> {whenOf(r.createdAt)}
                      </span>
                    </div>
                    <FolderPreview
                      folder={r.folder}
                      ruleId={r.id}
                      busy={busyRules.has(r.id)}
                      namedCount={namedCount}
                    />
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wide text-faint">
                        What changed in this folder
                      </span>
                      <button
                        onClick={() =>
                          window.api.openPath(
                            r.mode === 'rename' ? r.folder : `${r.folder}/${r.subfolder}`
                          )
                        }
                        className="text-[11px] text-mint hover:underline"
                        title="Browse the renamed clips in your file manager"
                      >
                        {r.mode === 'rename'
                          ? 'Open folder'
                          : `Open the renamed clips (${r.subfolder}/)`}
                      </button>
                    </div>
                    {changes.length === 0 ? (
                      <div className="pb-1 text-[11px] text-faint">
                        Nothing renamed yet — drop a new clip into the folder and it shows up here.
                      </div>
                    ) : (
                      <div className="max-h-[26vh] space-y-1 overflow-auto font-mono text-[11px]">
                        {changes.map((h, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="shrink-0 text-faint">{whenOf(h.at)}</span>
                            <span className="min-w-0 truncate text-muted" title={h.oldName}>
                              {h.oldName}
                            </span>
                            <span className="shrink-0 text-mint">→</span>
                            <span className="min-w-0 truncate text-text" title={h.newName}>
                              {h.newName}
                            </span>
                            {h.mode !== 'rename' && (
                              <span className="shrink-0 rounded bg-surface2 px-1 text-[9px] text-faint">
                                {h.mode === 'copy' ? 'copied' : 'moved'}
                              </span>
                            )}
                            {h.offline && (
                              <span
                                className="shrink-0 cursor-help rounded bg-peach/15 px-1 text-[9px] text-peach"
                                title={`Offline name (no credit used): ${h.offline}`}
                              >
                                offline
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {events.length > 0 && (
        <div>
          <div className="section-title mb-2">Live activity</div>
          <div className="max-h-[32vh] space-y-1 overflow-auto rounded-xl border border-borderSoft bg-surface2/40 p-2 font-mono text-[11px]">
            {events.map((ev, i) => (
              <div key={i} className="flex items-center gap-2">
                <span
                  className={
                    ev.status === 'named'
                      ? 'text-mint'
                      : ev.status === 'error'
                        ? 'text-danger'
                        : ev.status === 'missed'
                          ? 'text-peach'
                          : 'text-faint'
                  }
                >
                  {ev.status === 'named' ? '✓' : ev.status === 'error' ? '✕' : ev.status === 'processing' ? '…' : ev.status === 'missed' ? '!' : '•'}
                </span>
                <span className="shrink-0 text-faint">{timeOf(ev.at)}</span>
                <span className={`truncate ${ev.status === 'missed' ? 'text-peach' : 'text-muted'}`}>
                  {ev.status === 'error' ? ev.error : ev.message || ev.newName}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// What's in the folder RIGHT NOW, with real video/image thumbnails — so the
// user can see exactly what a rule would rename, and trigger the one-time
// "name everything already here" pass at any point (not only at rule creation).
function FolderPreview({
  folder,
  ruleId,
  busy,
  namedCount
}: {
  folder: string
  ruleId: string
  busy: boolean
  namedCount: number
}): React.ReactElement {
  const [files, setFiles] = useState<{ path: string; name: string }[]>([])
  const [loaded, setLoaded] = useState(false)
  const [kicked, setKicked] = useState(false)

  // A finished rename run refreshes the grid — also re-arm the button so
  // clips that arrive later can be named too.
  useEffect(() => {
    setKicked(false)
  }, [namedCount])

  // Refresh when opened and after every completed rename, so the grid always
  // mirrors the folder as it is on disk.
  useEffect(() => {
    let gone = false
    window.api
      .watchListMedia(folder)
      .then((f) => {
        if (!gone) {
          setFiles(f)
          setLoaded(true)
        }
      })
      .catch(() => setLoaded(true))
    return () => {
      gone = true
    }
  }, [folder, namedCount])

  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-faint">
          In this folder now {loaded ? `(${files.length})` : ''}
        </span>
        {files.length > 0 && (
          <button
            onClick={() => {
              setKicked(true)
              void window.api.watchProcessExisting(ruleId)
            }}
            disabled={busy || kicked}
            className="text-[11px] text-mint hover:underline disabled:cursor-default disabled:text-faint disabled:no-underline"
            title={`Runs every clip below through AI naming — uses ${files.length} credit${files.length === 1 ? '' : 's'}`}
          >
            {busy || kicked
              ? 'Naming clips… watch the activity feed below'
              : `Name all ${files.length} now (${files.length} credit${files.length === 1 ? '' : 's'})`}
          </button>
        )}
      </div>
      {!loaded ? (
        <div className="pb-1 text-[11px] text-faint">Looking in the folder…</div>
      ) : files.length === 0 ? (
        <div className="pb-1 text-[11px] text-faint">
          No clips at the top level of this folder. Clips inside subfolders aren’t watched — move
          them to the top level to rename them.
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1.5">
          {files.map((f) => (
            <div key={f.path} className="w-24 shrink-0">
              <MediaThumb path={f.path} className="h-16 w-24 rounded-lg" />
              <div className="mt-0.5 truncate text-[9px] text-faint" title={f.name}>
                {f.name}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
