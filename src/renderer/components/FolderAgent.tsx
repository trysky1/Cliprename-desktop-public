import React, { useEffect, useMemo, useState } from 'react'
import { AgentMode, AppSettings, MediaItem, NamingStyle, ScanResult } from '../../shared/types'
import { formatBytes } from '../lib/format'
import ActionToggle from './ActionToggle'
import { IconCopy, IconFolder, IconFolderInput, IconPen } from './Icons'
import MediaThumb from './MediaThumb'
import Step from './Step'
import StylePreset from './StylePreset'

interface Props {
  settings: AppSettings
  signedIn: boolean
  onOpenSettings: () => void
  onSaveSettings: (patch: Partial<AppSettings>) => void
}

// Folder path of `dir` relative to `root` ('' = sits directly in the chosen folder).
function relDir(dir: string, root: string): string {
  if (!root || dir === root) return ''
  const r = dir.startsWith(root) ? dir.slice(root.length) : dir
  return r.replace(/^[\\/]+/, '')
}

function baseName(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}

export default function FolderAgent({
  settings,
  signedIn,
  onOpenSettings,
  onSaveSettings
}: Props): React.ReactElement {
  const [root, setRoot] = useState('')
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [items, setItems] = useState<MediaItem[]>([])
  const [scanning, setScanning] = useState(false)
  const [naming, setNaming] = useState(false)
  const [applying, setApplying] = useState(false)
  const [style, setStyle] = useState<NamingStyle>(settings.style)
  const [mode, setMode] = useState<AgentMode>('copy')
  const [subfolder, setSubfolder] = useState('Renamed')
  const [groupByAction, setGroupByAction] = useState(false)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<{
    count: number
    verb: string
    dest: string
    inPlace: boolean
  } | null>(null)
  const [journalId, setJournalId] = useState('')
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'err' | 'info' } | null>(null)
  const [hover, setHover] = useState(false)

  const live = signedIn

  // Live per-item naming progress (scoped to this tab's items by id).
  useEffect(() => {
    const off = window.api.onSuggestProgress((p) => {
      setItems((prev) =>
        prev.map((it) =>
          it.id === p.id
            ? {
                ...it,
                status: p.status,
                suggestedName: p.suggestedName ?? it.suggestedName,
                category: p.category ?? it.category,
                description: p.description ?? it.description,
                actionGroup: p.actionGroup ?? it.actionGroup,
                error: p.error
              }
            : it
        )
      )
    })
    return off
  }, [])

  function flash(text: string, tone: 'ok' | 'err' | 'info' = 'info'): void {
    setMsg({ text, tone })
    window.setTimeout(() => setMsg((m) => (m && m.text === text ? null : m)), 5000)
  }

  async function loadFolder(folder: string): Promise<void> {
    setScanning(true)
    setResult(null)
    setEdits({})
    setExcluded(new Set())
    try {
      const res = await window.api.agentScan(folder)
      setRoot(res.root || folder)
      setScan(res)
      setItems(res.items)
      window.api.setSettings({ lastFolder: res.root || folder })
      if (res.items.length === 0)
        flash('No video or audio found in that folder (or its subfolders).', 'info')
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setScanning(false)
    }
  }

  async function pickFolder(): Promise<void> {
    const p = await window.api.pickFolder()
    if (p) loadFolder(p)
  }

  function handleDrop(e: React.DragEvent): void {
    e.preventDefault()
    setHover(false)
    const first = Array.from(e.dataTransfer.files)[0] as (File & { path?: string }) | undefined
    if (!first) return
    let p: string | undefined = first.path
    if (!p) {
      try {
        p = window.api.pathForFile(first)
      } catch {
        p = undefined
      }
    }
    if (p) loadFolder(p)
  }

  function changeStyle(s: NamingStyle): void {
    setStyle(s)
    window.api.setSettings({ style: s })
  }

  async function generateNames(): Promise<void> {
    if (items.length === 0) return
    setNaming(true)
    setResult(null)
    setItems((prev) => prev.map((i) => ({ ...i, status: 'analyzing' as const })))
    try {
      const res = await window.api.suggest(items)
      const map = new Map(res.items.map((i) => [i.id, i]))
      setItems((prev) => prev.map((i) => map.get(i.id) ?? i))
      flash('Names ready.', 'ok')
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setNaming(false)
    }
  }

  function nameOf(it: MediaItem): string {
    return (edits[it.id] ?? it.suggestedName ?? it.baseName).trim()
  }

  function toggle(id: string): void {
    setExcluded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // What the action will touch. For copy/move every included, named file is
  // taken (it's going to a new folder); for in-place rename only files whose
  // name actually changes.
  const pending = useMemo(
    () =>
      items.filter((it) => {
        if (excluded.has(it.id)) return false
        const n = nameOf(it)
        if (!n) return false
        if (mode === 'rename') return `${n}.${it.ext}` !== it.originalName
        return true
      }),
    [items, excluded, edits, mode]
  )

  const hasItems = items.length > 0
  const namedCount = items.filter((i) => i.suggestedName).length
  const destName = (subfolder || 'Renamed').trim() || 'Renamed'
  const verbing = mode === 'rename' ? 'renamed' : mode === 'copy' ? 'copied' : 'moved'
  const grouping = groupByAction && mode !== 'rename' && settings.actionNaming

  async function runNow(): Promise<void> {
    if (pending.length === 0) return
    setApplying(true)
    try {
      const payload = pending.map((it) => ({ ...it, suggestedName: nameOf(it) }))
      const res = await window.api.runAgent(root, payload, {
        mode,
        subfolder: destName,
        groupByAction: grouping
      })
      const verb = mode === 'rename' ? 'Renamed' : mode === 'copy' ? 'Copied' : 'Moved'
      if (res.errors.length)
        flash(`${verb} ${res.appliedCount}, with ${res.errors.length} problems.`, 'err')
      else flash(`${verb} ${res.appliedCount} files.`, 'ok')
      const dest = mode === 'rename' ? root : `${root.replace(/[\\/]+$/, '')}/${destName}`
      setJournalId(res.journalId)
      setResult({ count: res.appliedCount, verb, dest, inPlace: mode === 'rename' })
      // Refresh the listing where the originals changed name or location.
      if (mode === 'rename' || mode === 'move') {
        const fresh = await window.api.agentScan(root)
        setScan(fresh)
        setItems(fresh.items)
        setEdits({})
        setExcluded(new Set())
      }
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setApplying(false)
    }
  }

  async function undo(): Promise<void> {
    if (!journalId) return
    try {
      const res = await window.api.undo(journalId)
      flash(`Reversed ${res.undone} files.`, res.errors.length ? 'err' : 'ok')
      setResult(null)
      setJournalId('')
      const fresh = await window.api.agentScan(root)
      setScan(fresh)
      setItems(fresh.items)
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), 'err')
    }
  }

  const busy = scanning || naming || applying

  return (
    <div className="space-y-4">
      {/* Step 1 — choose the folder */}
      <Step
        n={1}
        title="Point the agent at a folder"
        desc="It searches the folder and every subfolder for video & audio. Images and other files are never touched."
        done={hasItems}
      >
        {!hasItems ? (
          <div
            onClick={pickFolder}
            onDragOver={(e) => {
              e.preventDefault()
              setHover(true)
            }}
            onDragLeave={() => setHover(false)}
            onDrop={handleDrop}
            className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all ${
              hover ? 'border-mint bg-mint/5 scale-[1.01]' : 'border-border bg-surface2/40 hover:border-faint'
            }`}
          >
            <div className="mx-auto mb-3 w-fit rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-faint">
              {scanning ? 'Reading' : 'Choose folder'}
            </div>
            <div className="text-base font-semibold">
              {scanning ? 'Looking through the folder…' : 'Drop a folder here, or click to choose one'}
            </div>
            {scan && items.length === 0 && !scanning && (
              <div className="mx-auto mt-4 max-w-sm rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[12px] text-warning">
                No video or audio found in <span className="font-mono">{baseName(root)}</span>. Try a
                different folder.
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-mint/10 text-mint">
              <IconFolder size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-text">{baseName(root)}</div>
              <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px]">
                <span className="chip">{scan?.counts.video ?? 0} video</span>
                <span className="chip">{scan?.counts.audio ?? 0} audio</span>
                <span className="text-faint">
                  · {formatBytes(scan?.totalBytes ?? 0)} · subfolders included
                </span>
              </div>
            </div>
            <button onClick={pickFolder} disabled={busy} className="btn shrink-0 !py-1.5 !px-3 text-xs">
              Change folder
            </button>
          </div>
        )}
      </Step>

      {/* Step 2 — how to name */}
      <Step
        n={2}
        title="Choose how to name the clips"
        desc="Pick a style. Turn on action naming to name each video by what's happening in it."
        disabled={!hasItems}
        done={hasItems && namedCount > 0}
      >
        <div className="space-y-3">
          <StylePreset value={style} onChange={changeStyle} />
          <ActionToggle
            on={settings.actionNaming}
            live={live}
            onChange={(v) => onSaveSettings({ actionNaming: v })}
          />
        </div>
      </Step>

      {/* Step 3 — what happens to the files */}
      <Step
        n={3}
        title="Choose what happens to your files"
        desc="Safest choice: keep your originals and put the renamed copies in a new folder."
        disabled={!hasItems}
      >
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <ModeCard
              active={mode === 'copy'}
              onClick={() => setMode('copy')}
              icon={<IconCopy size={15} />}
              title="Keep originals"
              desc="Copy renamed clips into a new folder. Originals stay untouched."
            />
            <ModeCard
              active={mode === 'move'}
              onClick={() => setMode('move')}
              icon={<IconFolderInput size={15} />}
              title="Move to new folder"
              desc="Rename and gather the clips into a new folder inside this one."
            />
            <ModeCard
              active={mode === 'rename'}
              onClick={() => setMode('rename')}
              icon={<IconPen size={15} />}
              title="Rename in place"
              desc="Change the original files' names right where they sit."
            />
          </div>

          {mode !== 'rename' && (
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-xs text-muted">New folder name</span>
              <input
                value={subfolder}
                onChange={(e) => setSubfolder(e.target.value)}
                placeholder="Renamed"
                className="field !py-1.5 max-w-[220px] font-mono text-xs"
              />
              <span className="truncate text-[11px] text-faint">inside {baseName(root) || 'your folder'}/</span>
            </div>
          )}

          {mode !== 'rename' && settings.actionNaming && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-borderSoft bg-surface2 px-3 py-2.5">
              <input
                type="checkbox"
                checked={groupByAction}
                onChange={(e) => setGroupByAction(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-mint"
              />
              <span className="min-w-0">
                <span className={`block text-[13px] font-medium ${groupByAction ? 'text-mint' : 'text-text'}`}>
                  Sort into folders by action
                </span>
                <span className="block text-[11px] leading-snug text-faint">
                  Groups clips by the activity in them — e.g.{' '}
                  <span className="font-mono">football/bicycle-kick.mp4</span>,{' '}
                  <span className="font-mono">cooking/frying-eggs.mp4</span>. Clips without a clear
                  action (and audio) go to <span className="font-mono">other-clips/</span>.
                </span>
              </span>
            </label>
          )}
        </div>
      </Step>

      {/* Step 4 — get names, review, run */}
      <Step
        n={4}
        title="Get names, review, and run"
        desc="Nothing changes until you press the button below — and you can undo right after."
        disabled={!hasItems}
        done={!!result}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={generateNames} disabled={busy} className="btn-primary">
              {naming ? (
                <>
                  <Spinner /> Reading files…
                </>
              ) : namedCount > 0 ? (
                'Suggest names again'
              ) : (
                `Suggest names for ${items.length} clips`
              )}
            </button>
            {items.length > 0 && (
              <span className="text-[11px] text-faint">
                Uses 1 credit per clip — same as naming on cliprename.com.
              </span>
            )}
          </div>

          {hasItems && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-muted">
                  Review the changes {namedCount > 0 && `· ${pending.length} will change`}
                </div>
                <div className="text-[11px] text-faint">tick to include · edit any name</div>
              </div>
              <div className="max-h-[44vh] space-y-1.5 overflow-auto pr-1">
                {items.map((it) => {
                  const skip = excluded.has(it.id)
                  const sub = relDir(it.dir, root)
                  const changed = `${nameOf(it)}.${it.ext}` !== it.originalName
                  return (
                    <div
                      key={it.id}
                      className={`flex items-center gap-3 rounded-xl border border-borderSoft px-3 py-2 ${
                        skip ? 'opacity-40' : 'bg-surface'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={!skip}
                        onChange={() => toggle(it.id)}
                        className="h-4 w-4 accent-mint"
                      />
                      <MediaThumb path={it.path} kind={it.kind} className="h-10 w-12 rounded-lg" />
                      <div className="w-40 shrink-0">
                        {sub && (
                          <div className="truncate font-mono text-[10px] text-faint" title={sub}>
                            {sub}/
                          </div>
                        )}
                        <div
                          className="truncate font-mono text-xs text-faint line-through"
                          title={it.originalName}
                        >
                          {it.originalName}
                        </div>
                      </div>
                      <span className={changed || grouping ? 'text-mint' : 'text-faint'}>→</span>
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        {grouping && (
                          <span
                            className="max-w-[90px] shrink-0 truncate font-mono text-[10px] text-mint/80"
                            title={`${it.actionGroup || 'other-clips'}/`}
                          >
                            {(it.actionGroup || 'other-clips') + '/'}
                          </span>
                        )}
                        <input
                          value={nameOf(it)}
                          onChange={(e) => setEdits((p) => ({ ...p, [it.id]: e.target.value }))}
                          className={`field !py-1.5 font-mono text-xs ${
                            it.status === 'analyzing' ? 'animate-pulse' : ''
                          }`}
                        />
                        <span className="text-xs text-faint">.{it.ext}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Mode-aware explanation */}
          {mode === 'copy' ? (
            <div className="rounded-xl border border-mint/30 bg-mint/5 px-4 py-3 text-[12px] text-muted">
              Your originals stay exactly as they are. {pending.length} renamed{' '}
              {pending.length === 1 ? 'copy' : 'copies'} will be placed in{' '}
              <span className="font-mono text-mint">
                {baseName(root)}/{destName}
              </span>
              {grouping && <> — sorted into folders by action</>}.
            </div>
          ) : mode === 'move' ? (
            <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-[12px] text-warning">
              {pending.length} files will be renamed and <b>moved</b> into{' '}
              <span className="font-mono">
                {baseName(root)}/{destName}
              </span>
              {grouping && <> (sorted into folders by action)</>}, leaving their original spot. You
              can undo right after.
            </div>
          ) : (
            <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-[12px] text-warning">
              This renames the <b>original files</b> in{' '}
              <span className="font-mono">{baseName(root)}</span> and its subfolders, right where
              they sit. You can undo right after.
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs text-faint">
              {pending.length} of {items.length} files will be {verbing}
            </span>
            <button
              onClick={runNow}
              disabled={applying || naming || pending.length === 0}
              className="btn-primary"
            >
              {applying ? (
                <>
                  <Spinner /> Working…
                </>
              ) : mode === 'rename' ? (
                `Rename ${pending.length} files in place`
              ) : mode === 'copy' ? (
                `Copy ${pending.length} files to ${destName}`
              ) : (
                `Move ${pending.length} files to ${destName}`
              )}
            </button>
          </div>
        </div>
      </Step>

      {/* Result / undo */}
      {result && (
        <div className="card flex items-center gap-3 px-4 py-3">
          <span className="text-sm text-text">
            {result.verb} <b>{result.count}</b> files{result.inPlace ? ' in place' : ''}
          </span>
          <div className="ml-auto flex gap-2">
            <button onClick={() => window.api.openPath(result.dest)} className="btn !py-1.5 text-xs">
              Open folder
            </button>
            <button onClick={undo} className="btn !py-1.5 text-xs">
              Undo
            </button>
            <button onClick={() => setResult(null)} className="btn-ghost !py-1.5 text-xs">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Status line */}
      {msg && (
        <div
          className={`text-center text-sm ${
            msg.tone === 'ok' ? 'text-mint' : msg.tone === 'err' ? 'text-danger' : 'text-muted'
          }`}
        >
          {msg.text}
        </div>
      )}
    </div>
  )
}

function Spinner(): React.ReactElement {
  return (
    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-mint-ink/30 border-t-mint-ink" />
  )
}

interface ModeCardProps {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  desc: string
}

function ModeCard({ active, onClick, icon, title, desc }: ModeCardProps): React.ReactElement {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
        active ? 'border-mint bg-mint/10 shadow-glow' : 'border-borderSoft bg-surface2 hover:border-faint'
      }`}
    >
      <div className={`flex items-center gap-1.5 text-[13px] font-medium ${active ? 'text-mint' : 'text-text'}`}>
        {icon}
        {title}
      </div>
      <div className="mt-0.5 text-[11px] leading-snug text-faint">{desc}</div>
    </button>
  )
}
