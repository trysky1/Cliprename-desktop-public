import React, { useEffect, useRef, useState } from 'react'
import {
  AppSettings,
  ApplyMode,
  DEFAULT_SETTINGS,
  MediaItem,
  ScanResult,
  SortOption,
  SortPlan,
  TrayItem
} from '../shared/types'
import Header from './components/Header'
import StylePreset from './components/StylePreset'
import DropZone from './components/DropZone'
import FileList from './components/FileList'
import PreviewModal from './components/PreviewModal'
import ChatSort from './components/ChatSort'
import SettingsModal from './components/SettingsModal'
import ActionToggle from './components/ActionToggle'
import AutoClipper from './components/AutoClipper'
import ClipWorkspace from './components/ClipWorkspace'
import FolderAgent from './components/FolderAgent'
import SendToEditor from './components/SendToEditor'
import LibraryPanel from './components/LibraryPanel'
import AutomationPanel from './components/AutomationPanel'
import PresetBar from './components/PresetBar'
import SceneSplit from './components/SceneSplit'
import { IconBot, IconFolder, IconScissors, IconSparkles } from './components/Icons'
import SignInGate from './components/SignInGate'
import Step from './components/Step'
import Tray from './components/Tray'
import Welcome from './components/Welcome'
import { addUsage } from './lib/usage'

const SUPPORT_URL = 'https://cliprename.com/support'
// The tabs are the TOOLS. The Library is not a tool — it's the record of
// everything the tools produced, so it floats above them (header button →
// overlay), like the Tray.
type Mode = 'auto' | 'clip' | 'chat' | 'automation'

export default function App(): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [ffmpegOk, setFfmpegOk] = useState(false)
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [outputDir, setOutputDir] = useState('')
  const [mode, setMode] = useState<Mode>('auto')
  // Automation tab hosts two hands-off tools: watch folders + the folder agent.
  const [autoTool, setAutoTool] = useState<'watch' | 'agent'>('watch')
  const [scanning, setScanning] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [lastJournal, setLastJournal] = useState<{ id: string; count: number; mode?: ApplyMode } | null>(null)
  const [status, setStatus] = useState<{ text: string; tone: 'ok' | 'err' | 'info' } | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [tray, setTray] = useState<TrayItem[]>([])
  const [showTray, setShowTray] = useState(false)
  const [sources, setSources] = useState<string[]>([])
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [cloud, setCloud] = useState<{ signedIn: boolean; email: string; tier: string }>({
    signedIn: false,
    email: '',
    tier: ''
  })
  // Don't flash the sign-in wall while the stored session is still loading.
  const [cloudLoaded, setCloudLoaded] = useState(false)
  // Remaining AI credits today (plan allowance minus usage) for the header chip.
  const [creditsLeft, setCreditsLeft] = useState<number | null>(null)

  // Escape closes whichever overlay is open (library first, then tray).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setShowLibrary(false)
      setShowTray(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function refreshCredits(): void {
    window.api
      .cloudUsage()
      .then((u) => setCreditsLeft(Math.max(0, u.dailyLimit - u.daily)))
      .catch(() => setCreditsLeft(null))
  }

  const scanRef = useRef<ScanResult | null>(null)
  scanRef.current = scan

  const live = cloud.signedIn

  // Lazily build real content thumbnails for video & image files.
  useEffect(() => {
    if (!scan) {
      setThumbs({})
      return
    }
    let cancelled = false
    setThumbs({})
    const media = scan.items.filter((i) => i.kind === 'video' || i.kind === 'image').slice(0, 200)
    let idx = 0
    async function worker(): Promise<void> {
      while (!cancelled) {
        const i = idx++
        if (i >= media.length) break
        const it = media[i]
        try {
          const url = await window.api.thumb(it.path, it.kind)
          if (url && !cancelled) setThumbs((prev) => ({ ...prev, [it.id]: url }))
        } catch {
          /* ignore */
        }
      }
    }
    Promise.all(Array.from({ length: 4 }, worker))
    return () => {
      cancelled = true
    }
  }, [scan?.root, scan?.items.length])

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettings(s)
      setSettingsLoaded(true)
      if (s.outputDir) setOutputDir(s.outputDir)
    })
    window.api
      .cloudStatus()
      .then((s) => {
        setCloud(s)
        if (s.signedIn) refreshCredits()
      })
      .catch(() => {})
      .finally(() => setCloudLoaded(true))
    window.api.ffmpegAvailable().then(setFfmpegOk)
    const off = window.api.onSuggestProgress((p) => {
      setScan((prev) => {
        if (!prev) return prev
        const items = prev.items.map((it) =>
          it.id === p.id
            ? {
                ...it,
                status: p.status,
                suggestedName: p.suggestedName ?? it.suggestedName,
                category: p.category ?? it.category,
                tags: p.tags ?? it.tags,
                description: p.description ?? it.description,
                actionGroup: p.actionGroup ?? it.actionGroup,
                error: p.error
              }
            : it
        )
        return { ...prev, items }
      })
    })
    // Automation consumes credits in the background — keep the header chip live.
    const offAuto = window.api.onAutomationEvent((ev) => {
      if (ev.status === 'named') refreshCredits()
    })
    return () => {
      off()
      offAuto()
    }
  }, [])

  function flash(text: string, tone: 'ok' | 'err' | 'info' = 'info'): void {
    setStatus({ text, tone })
    window.setTimeout(() => setStatus(null), 4500)
  }

  // Rescan the union of all chosen input sources. A monotonic token guards
  // against out-of-order results: if two scans overlap, only the latest one's
  // result is applied, so the file list can't be clobbered by a slower earlier
  // scan (also makes StrictMode's double-invoke harmless).
  const scanSeq = useRef(0)
  async function rescan(srcs: string[]): Promise<void> {
    const seq = ++scanSeq.current
    if (srcs.length === 0) {
      setScan(null)
      return
    }
    setScanning(true)
    setLastJournal(null)
    try {
      const res = await window.api.scanPaths(srcs)
      if (seq !== scanSeq.current) return // a newer scan superseded this one
      setScan(res)
      if (res.root) window.api.setSettings({ lastFolder: res.root })
      if (!outputDir && res.root) setOutputDir(`${res.root.replace(/[\\/]+$/, '')}/Organized`)
    } catch (e) {
      if (seq === scanSeq.current) flash(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      if (seq === scanSeq.current) setScanning(false)
    }
  }

  function addSources(paths: string[]): void {
    const next = Array.from(new Set([...sources, ...paths]))
    setSources(next)
    rescan(next)
  }

  function removeSource(p: string): void {
    const next = sources.filter((s) => s !== p)
    setSources(next)
    rescan(next)
  }

  async function addFiles(): Promise<void> {
    const paths = await window.api.pickFiles()
    if (paths.length) addSources(paths)
  }

  async function addFolder(): Promise<void> {
    const p = await window.api.pickFolder()
    if (p) addSources([p])
  }

  function removeItem(id: string): void {
    setScan((prev) => {
      if (!prev) return prev
      const items = prev.items.filter((i) => i.id !== id)
      const counts = { video: 0, audio: 0, image: 0, other: 0 } as Record<string, number>
      let totalBytes = 0
      for (const it of items) {
        counts[it.kind]++
        totalBytes += it.sizeBytes
      }
      return { ...prev, items, counts: counts as ScanResult['counts'], totalBytes }
    })
  }

  function clearAll(): void {
    setSources([])
    setScan(null)
    setLastJournal(null)
  }

  async function changeTrayFolder(): Promise<void> {
    const p = await window.api.pickOutputDir()
    if (p) {
      const s = await window.api.setSettings({ trayDir: p })
      setSettings(s)
      flash('Tray clips will now be saved to ' + p, 'ok')
    }
  }

  async function addToTray(item: MediaItem, range?: { start: number; end: number }): Promise<void> {
    const baseName = item.suggestedName || item.baseName
    try {
      const res = await window.api.stageClip({
        srcPath: item.path,
        baseName,
        ext: item.ext,
        kind: item.kind,
        startSec: range?.start,
        endSec: range?.end
      })
      // If ffmpeg couldn't trim, the untouched original was staged instead —
      // never label that "Trimmed", and tell the user what actually happened.
      const trimWorked = !!range && !res.fallback
      setTray((prev) => [
        ...prev,
        {
          id: 'tr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          label: `${baseName}.${item.ext}`,
          stagedPath: res.stagedPath,
          kind: item.kind,
          trimmed: trimWorked
        }
      ])
      if (range && res.fallback)
        flash('Couldn’t trim this clip — the full, untrimmed file was added to the tray instead', 'err')
      else flash(range ? 'Trimmed clip added to tray' : 'Added to tray', 'ok')
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), 'err')
    }
  }

  // Register already-staged files (scene split / auto clipper output) as tray items.
  // Kind is inferred from the extension so audio auto-clips get the audio
  // preview instead of a black <video> box.
  function addStagedToTray(clips: { path: string }[]): void {
    const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'wma', 'aiff', 'aif'])
    setTray((prev) => [
      ...prev,
      ...clips.map((c) => {
        const ext = (c.path.split('.').pop() || '').toLowerCase()
        return {
          id: 'tr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          label: c.path.split(/[\\/]/).pop() || 'clip',
          stagedPath: c.path,
          kind: (AUDIO_EXTS.has(ext) ? 'audio' : 'video') as 'video' | 'audio',
          trimmed: true
        }
      })
    ])
  }

  function removeFromTray(id: string): void {
    setTray((prev) => {
      const item = prev.find((t) => t.id === id)
      if (item) window.api.removeStaged(item.stagedPath)
      return prev.filter((t) => t.id !== id)
    })
  }

  function clearTray(): void {
    tray.forEach((t) => window.api.removeStaged(t.stagedPath))
    setTray([])
  }

  async function addEditedImageToTray(
    item: MediaItem,
    edits: { crop?: { x: number; y: number; w: number; h: number }; rotate: number; flipH: boolean }
  ): Promise<void> {
    const baseName = item.suggestedName || item.baseName
    try {
      const res = await window.api.editImage({
        srcPath: item.path,
        baseName,
        ext: item.ext,
        crop: edits.crop,
        rotate: edits.rotate,
        flipH: edits.flipH
      })
      const editWorked = !!(edits.crop || edits.rotate || edits.flipH) && !res.fallback
      setTray((prev) => [
        ...prev,
        {
          id: 'tr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          label: `${baseName}.${item.ext}`,
          stagedPath: res.stagedPath,
          kind: item.kind,
          trimmed: editWorked
        }
      ])
      if (res.fallback && (edits.crop || edits.rotate || edits.flipH))
        flash('Couldn’t apply the edits — the original image was added to the tray instead', 'err')
      else flash('Edited image added to tray', 'ok')
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), 'err')
    }
  }

  async function analyze(): Promise<void> {
    if (!scan || scan.items.length === 0) return
    setAnalyzing(true)
    setScan((prev) =>
      prev ? { ...prev, items: prev.items.map((i) => ({ ...i, status: 'analyzing' as const })) } : prev
    )
    try {
      const res = await window.api.suggest(scan.items)
      const map = new Map(res.items.map((i) => [i.id, i]))
      setScan((prev) => (prev ? { ...prev, items: prev.items.map((i) => map.get(i.id) ?? i) } : prev))
      // Record named files in the searchable library (also powers duplicate detection).
      window.api.libraryAdd(res.items.filter((i) => i.suggestedName)).catch(() => {})
      refreshCredits()
      // Honest summary — some files can fail (quota, unreadable file) without
      // failing the batch. And stay on this tab: jumping away before Step 4
      // (Apply) left users thinking renaming was done when it hadn't started.
      const failed = res.items.filter((i) => i.status === 'error')
      if (failed.length === 0) flash('All names ready — review below, then apply', 'ok')
      else if (failed.length < res.items.length)
        flash(
          `${res.items.length - failed.length} names ready — ${failed.length} couldn’t be named (${failed[0].error ?? 'see the list below'})`,
          'err'
        )
      else flash(`Couldn’t name these files: ${failed[0].error ?? 'try again in a moment'}`, 'err')
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setAnalyzing(false)
    }
  }

  async function pickOutput(): Promise<void> {
    const p = await window.api.pickOutputDir()
    if (p) {
      setOutputDir(p)
      window.api.setSettings({ outputDir: p })
    }
  }

  async function applyRename(edited: MediaItem[], mode: ApplyMode, organize: boolean): Promise<void> {
    setApplying(true)
    try {
      const queued = edited.filter((i) => i.suggestedName)
      const res = await window.api.apply(queued, { mode, outputDir, organizeByCategory: organize })
      addUsage(res.appliedCount)
      setShowPreview(false)
      // On partial failure, say WHAT went wrong — "N problems" was a dead end.
      if (res.errors.length)
        flash(
          `Renamed ${res.appliedCount} files — ${res.errors.length} couldn’t be changed (${res.errors[0]?.message ?? 'file may be open in another app'}). Nothing else was touched.`,
          'err'
        )
      else setLastJournal({ id: res.journalId, count: res.appliedCount, mode })
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setApplying(false)
    }
  }

  async function undo(): Promise<void> {
    if (!lastJournal) return
    try {
      const res = await window.api.undo(lastJournal.id)
      setLastJournal(null)
      flash(
        res.errors.length
          ? `Put back ${res.undone} files — ${res.errors.length} couldn’t be undone (they may have been moved since)`
          : `Undo complete — ${res.undone} files are back where they were`,
        res.errors.length ? 'err' : 'ok'
      )
    } catch (e) {
      flash(`Couldn’t undo — ${e instanceof Error ? e.message : 'the files may have been moved since'}`, 'err')
    }
  }

  async function planSort(instruction: string): Promise<SortPlan> {
    if (!scan || scan.items.length === 0)
      return { possible: false, reason: '', message: 'Open some files or a folder first.', options: [] }

    let workItems = scan.items
    // If the clips haven't been looked at yet, watch them first so chat can "see" the content.
    const needsAnalysis = workItems.some((i) => i.status !== 'done')
    if (needsAnalysis) {
      setAnalyzing(true)
      setScan((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((i) =>
                i.status === 'done' ? i : { ...i, status: 'analyzing' as const }
              )
            }
          : prev
      )
      try {
        const res = await window.api.suggest(workItems)
        workItems = res.items
        const map = new Map(res.items.map((i) => [i.id, i]))
        setScan((prev) => (prev ? { ...prev, items: prev.items.map((i) => map.get(i.id) ?? i) } : prev))
      } catch (e) {
        setAnalyzing(false)
        return {
          possible: false,
          reason: e instanceof Error ? e.message : String(e),
          message: 'I had trouble looking at your clips. Make sure you are signed in, in Settings.',
          options: []
        }
      }
      setAnalyzing(false)
      refreshCredits()
    }
    const plan = await window.api.planSort(instruction, workItems)
    refreshCredits()
    return plan
  }

  async function applySortOption(option: SortOption): Promise<boolean> {
    if (!scan) return false
    if (!outputDir) {
      flash('Choose where to save first — open “Review & apply” in step 4 and pick a folder.', 'err')
      return false
    }
    setApplying(true)
    try {
      const res = await window.api.applySort(scan.items, option.assignments, {
        mode: settings.defaultMode,
        outputDir,
        organizeByCategory: false
      })
      addUsage(res.appliedCount)
      if (res.errors.length) {
        flash(
          `Sorted ${res.appliedCount} files — ${res.errors.length} couldn’t be moved (${res.errors[0]?.message ?? 'file may be open in another app'})`,
          'err'
        )
      } else {
        setLastJournal({ id: res.journalId, count: res.appliedCount, mode: settings.defaultMode })
      }
      // The files just moved/copied — refresh the list so old plans can't be
      // applied against paths that no longer exist.
      void rescan(sources)
      return res.errors.length === 0
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), 'err')
      return false
    } finally {
      setApplying(false)
    }
  }

  function saveSettings(patch: Partial<AppSettings>): void {
    window.api.setSettings(patch).then(setSettings)
  }

  const items = scan?.items ?? []
  const namedCount = items.filter((i) => i.suggestedName).length
  const analyzeDone = items.filter((i) => i.status === 'done' || i.status === 'error').length

  // The whole app requires the cliprename.com account: every feature runs on
  // the plan's credits, so nothing renders until the user is signed in.
  if (!cloudLoaded) return <div className="h-full" />
  if (!cloud.signedIn) {
    return (
      <SignInGate
        onSignedIn={(s) => {
          setCloud(s)
          refreshCredits()
        }}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <Header
        trayCount={tray.length}
        creditsLeft={creditsLeft}
        onOpenSettings={() => setShowSettings(true)}
        onOpenTray={() => setShowTray(true)}
        onOpenLibrary={() => setShowLibrary(true)}
      />

      {/* Mode switch + plain-language subtitle for the active tab */}
      <div className="flex flex-col items-center gap-1.5 pb-3">
        <div className="inline-flex rounded-2xl border border-border bg-surface p-1">
          <ModeTab
            on={mode === 'auto'}
            onClick={() => setMode('auto')}
            icon={<IconSparkles size={15} />}
            label="Clean up names"
          />
          <ModeTab
            on={mode === 'clip'}
            onClick={() => setMode('clip')}
            icon={<IconScissors size={15} />}
            label="Trim clips"
          />
          <ModeTab
            on={mode === 'automation'}
            onClick={() => setMode('automation')}
            icon={<IconBot size={15} />}
            label="Automation"
          />
        </div>
        <div className="text-xs text-faint">
          {mode === 'auto'
            ? 'Give every file in a folder a clean, descriptive name.'
            : mode === 'clip'
              ? 'Trim clips to the good part and drag them straight into your editor.'
              : 'Hands-off renaming — watch folders, or run the agent on one folder.'}
        </div>
      </div>

      <main className="flex-1 overflow-auto px-5 pb-28">
        <div className={`mx-auto w-full space-y-4 ${mode === 'clip' ? 'max-w-4xl' : 'max-w-2xl'}`}>
          {/* Automation — watch folders + one-off folder agent, one tab */}
          {mode === 'automation' && (
            <>
              <div className="flex justify-center">
                <div className="inline-flex rounded-xl border border-borderSoft bg-surface p-0.5">
                  <button
                    onClick={() => setAutoTool('watch')}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors ${
                      autoTool === 'watch' ? 'bg-mint text-mint-ink' : 'text-muted hover:text-text'
                    }`}
                  >
                    Watch folders
                  </button>
                  <button
                    onClick={() => setAutoTool('agent')}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors ${
                      autoTool === 'agent' ? 'bg-mint text-mint-ink' : 'text-muted hover:text-text'
                    }`}
                  >
                    Folder Agent
                  </button>
                </div>
              </div>
              {autoTool === 'watch' ? (
                <AutomationPanel />
              ) : (
                <FolderAgent
                  settings={settings}
                  signedIn={cloud.signedIn}
                  onOpenSettings={() => setShowSettings(true)}
                  onSaveSettings={saveSettings}
                />
              )}
            </>
          )}

          {/* Step 1: add files (shared by Clean up names + Clipping) */}
          {(mode === 'auto' || mode === 'clip') && (
            <Step
              n={1}
              title="Add your files"
              desc="Drop folders or files from any drive — we find every video, audio, and image inside."
              done={items.length > 0}
            >
              <DropZone
                sources={sources}
                scan={scan}
                scanning={scanning}
                lastFolder={settings.lastFolder}
                onAddFiles={addFiles}
                onAddFolder={addFolder}
                onDropPaths={addSources}
                onRemoveSource={removeSource}
                onReopenLast={() => settings.lastFolder && addSources([settings.lastFolder])}
              />
            </Step>
          )}

          {/* Clean up names — guided steps 2-4 */}
          {mode === 'auto' && (
            <>
              <Step
                n={2}
                title="Choose how names should look"
                desc="Pick a style. You can also name videos by the action happening in them."
                disabled={items.length === 0}
                done={items.length > 0 && namedCount > 0}
              >
                <div className="space-y-3">
                  <PresetBar settings={settings} onApply={saveSettings} />
                  <StylePreset value={settings.style} onChange={(style) => saveSettings({ style })} />
                  <ActionToggle
                    on={settings.actionNaming}
                    live={live}
                    onChange={(v) => saveSettings({ actionNaming: v })}
                  />
                </div>
              </Step>

              <Step
                n={3}
                title="Get clean names"
                desc="We look at every file and suggest a clear name — 1 credit per file, from your plan. Nothing on disk changes yet."
                disabled={items.length === 0}
                done={namedCount > 0}
              >
                <div className="space-y-4">
                  <button onClick={analyze} disabled={analyzing} className="btn-primary">
                    {analyzing ? (
                      <>
                        <Spinner /> Reading your files…
                      </>
                    ) : namedCount > 0 ? (
                      'Suggest again'
                    ) : (
                      `Suggest names for ${items.length} files`
                    )}
                  </button>

                  {analyzing && (
                    <div>
                      <div className="mb-1 flex justify-between text-xs text-muted">
                        <span>Looking at each file…</span>
                        <span>
                          {analyzeDone} of {items.length}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-surface2">
                        <div
                          className="h-full rounded-full bg-mint transition-all"
                          style={{ width: `${items.length ? (analyzeDone / items.length) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <FileList
                    items={items}
                    analyzing={analyzing}
                    thumbs={thumbs}
                    onRemove={removeItem}
                    onClear={clearAll}
                    onAddToTray={addToTray}
                  />
                </div>
              </Step>

              <Step
                n={4}
                title="Apply the new names"
                desc="Review every change first — edit any name, skip files, undo right after."
                disabled={items.length === 0}
                done={!!lastJournal}
              >
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setShowPreview(true)}
                    disabled={analyzing}
                    className="btn-primary"
                  >
                    Review &amp; apply ({items.length} files)
                  </button>
                  {namedCount > 0 && !analyzing && (
                    <button onClick={() => setMode('clip')} className="btn">
                      Continue to clipping →
                    </button>
                  )}
                </div>
              </Step>

              {/* Step 5: hand off an organized project to the editor */}
              <Step
                n={5}
                title="Send to your editor"
                desc="Export an organized project — clips named and sorted into bins — that Premiere, Final Cut, or DaVinci opens directly."
                disabled={namedCount === 0}
              >
                <SendToEditor items={items} actionNaming={settings.actionNaming} />
              </Step>

              {/* Optional chat sorting */}
              {items.length > 0 && (
                <section className="card p-5">
                  <div className="mb-3">
                    <div className="section-title">
                      Sort into folders with chat{' '}
                      <span className="chip ml-1 align-middle">optional</span>
                    </div>
                    <div className="section-desc">
                      Describe how you want your {items.length} files organized — e.g. “put drone
                      shots in /aerial” — and apply a folder layout in one click. Each request uses
                      1 credit, plus 1 credit per file that hasn’t been named yet (so the AI can see
                      what’s in it).
                    </div>
                  </div>
                  <ChatSort
                    items={items}
                    live={live}
                    applying={applying}
                    onPlan={planSort}
                    onApplyOption={applySortOption}
                    applyMode={settings.defaultMode}
                    onOpenSupport={() => window.api.openExternal(SUPPORT_URL)}
                  />
                </section>
              )}
            </>
          )}

          {/* Clipping — step 2: trim & collect */}
          {mode === 'clip' && (
            <Step
              n={2}
              title="Trim clips and collect them in your tray"
              desc="Nothing is exported — trimmed clips land in the tray, ready to drag into your editor."
              disabled={items.length === 0}
            >
              <div className="space-y-4">
                <AutoClipper
                  items={items}
                  onClips={(clips) => {
                    addStagedToTray(clips)
                    flash(`${clips.length} good segments added to your tray`, 'ok')
                  }}
                />
                <SceneSplit
                  items={items}
                  onClips={(clips) => {
                    addStagedToTray(clips)
                    flash(`${clips.length} scene clips added to your tray`, 'ok')
                  }}
                />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-borderSoft bg-surface2/60 px-4 py-2.5 text-[12px] text-muted">
                  <span>
                    <span className="font-mono text-mint">1.</span> Pick a clip below
                  </span>
                  <span>
                    <span className="font-mono text-mint">2.</span> Drag the handles around the part
                    you want
                  </span>
                  <span>
                    <span className="font-mono text-mint">3.</span> Add to tray, then drag the tray
                    into Premiere / AE / DaVinci
                  </span>
                </div>
                <ClipWorkspace
                  items={items}
                  thumbs={thumbs}
                  onAddToTray={addToTray}
                  onAddEditedImage={addEditedImageToTray}
                  onCreditUsed={refreshCredits}
                />
              </div>
            </Step>
          )}

          {!scan && (mode === 'auto' || mode === 'clip') && (
            <div className="pt-2 text-center text-xs text-faint">
              Tip: drag in any folder of clips — nothing is renamed until you review and apply.
            </div>
          )}
        </div>
      </main>

      {/* Bottom bar: result / status */}
      <BottomBar
        busy={scanning || analyzing || applying}
        busyText={scanning ? 'Scanning folder…' : analyzing ? 'Naming your files…' : applying ? 'Organizing…' : ''}
        status={status}
        result={lastJournal}
        outputDir={outputDir}
        onUndo={undo}
        onOpen={() => window.api.openPath(outputDir)}
        onDismiss={() => setLastJournal(null)}
      />

      {showPreview && scan && (
        <PreviewModal
          items={items}
          thumbs={thumbs}
          defaultMode={settings.defaultMode}
          organizeByCategory={settings.organizeByCategory}
          outputDir={outputDir}
          onPickOutput={pickOutput}
          onClose={() => setShowPreview(false)}
          onApply={applyRename}
          applying={applying}
        />
      )}

      {settingsLoaded && !settings.welcomed && (
        <Welcome
          onPick={(m) => {
            if (m === 'agent') {
              setMode('automation')
              setAutoTool('agent')
            } else {
              setMode(m)
            }
            saveSettings({ welcomed: true })
          }}
          onDismiss={() => saveSettings({ welcomed: true })}
        />
      )}

      {/* Library — floats above the tools: the record of everything they made */}
      {showLibrary && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setShowLibrary(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-borderSoft px-6 py-4">
              <div className="flex items-center gap-2.5">
                <IconFolder size={17} />
                <div>
                  <div className="section-title">Library</div>
                  <div className="section-desc">
                    Everything you’ve named, searchable — and a duplicate finder.
                  </div>
                </div>
              </div>
              <button onClick={() => setShowLibrary(false)} className="btn-ghost text-lg">
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-5">
              <LibraryPanel />
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <SettingsModal
          ffmpegOk={ffmpegOk}
          onClose={() => {
            setShowSettings(false)
            // The user may have signed out (→ back to the sign-in wall) or
            // changed plans — re-read both.
            window.api.cloudStatus().then(setCloud).catch(() => {})
            refreshCredits()
          }}
          onOpenExternal={(url) => window.api.openExternal(url)}
        />
      )}

      <Tray
        open={showTray}
        items={tray}
        trayDir={settings.trayDir}
        onClose={() => setShowTray(false)}
        onRemove={removeFromTray}
        onClear={clearTray}
        onReveal={() => window.api.revealTray()}
        onChangeFolder={changeTrayFolder}
      />
    </div>
  )
}

function ModeTab({
  on,
  onClick,
  icon,
  label
}: {
  on: boolean
  onClick: () => void
  icon?: React.ReactNode
  label: string
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
        on ? 'bg-mint text-mint-ink' : 'text-muted hover:bg-surface2 hover:text-text'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function Spinner(): React.ReactElement {
  return (
    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-mint-ink/30 border-t-mint-ink" />
  )
}

interface BottomBarProps {
  busy: boolean
  busyText: string
  status: { text: string; tone: 'ok' | 'err' | 'info' } | null
  result: { id: string; count: number; mode?: ApplyMode } | null
  outputDir: string
  onUndo: () => void
  onOpen: () => void
  onDismiss: () => void
}

function BottomBar({
  busy,
  busyText,
  status,
  result,
  outputDir,
  onUndo,
  onOpen,
  onDismiss
}: BottomBarProps): React.ReactElement | null {
  if (busy) {
    return (
      <Bar>
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-mint/30 border-t-mint" />
        <span className="text-sm text-text">{busyText}</span>
      </Bar>
    )
  }
  if (result) {
    return (
      <Bar>
        <span className="text-sm text-text">
          {result.mode === 'move' ? (
            <>
              Moved <b>{result.count}</b> files into their new home
            </>
          ) : (
            <>
              Made a tidy, renamed copy of <b>{result.count}</b> files
            </>
          )}
        </span>
        <div className="ml-auto flex gap-2">
          <button onClick={onOpen} className="btn !py-1.5 text-xs">
            Open folder
          </button>
          <button onClick={onUndo} className="btn !py-1.5 text-xs">
            Undo
          </button>
          <button onClick={onDismiss} className="btn-ghost !py-1.5 text-xs">
            Dismiss
          </button>
        </div>
      </Bar>
    )
  }
  if (status) {
    return (
      <Bar>
        <span
          className={`text-sm ${
            status.tone === 'ok' ? 'text-mint' : status.tone === 'err' ? 'text-peach' : 'text-muted'
          }`}
        >
          {status.text}
        </span>
      </Bar>
    )
  }
  return null
}

function Bar({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center p-4">
      <div className="card pointer-events-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3 shadow-soft">
        {children}
      </div>
    </div>
  )
}
