import React, { useEffect, useRef, useState } from 'react'
import { MediaItem } from '../../shared/types'

interface Props {
  item: MediaItem
  onAddToTray: (item: MediaItem, range?: { start: number; end: number }) => void
  onCreditUsed: () => void
}

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const cs = Math.floor((sec % 1) * 100)
  return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`
}

export default function VideoEditor({ item, onAddToTray, onCreditUsed }: Props): React.ReactElement {
  const isVideo = item.kind === 'video'
  const url = window.api.clipUrl(item.path)
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)

  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [inPoint, setInPoint] = useState(0)
  const [outPoint, setOutPoint] = useState(0)
  const [strip, setStrip] = useState<string[]>([])
  const [loadError, setLoadError] = useState(false)
  const [name, setName] = useState(item.suggestedName || item.baseName)
  const [renaming, setRenaming] = useState(false)
  const [renameNote, setRenameNote] = useState('')
  const [wave, setWave] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [beats, setBeats] = useState<number[]>([])
  const [bpm, setBpm] = useState(0)
  const [snap, setSnap] = useState(true)
  const [findingBeats, setFindingBeats] = useState(false)
  const [markerMsg, setMarkerMsg] = useState('')
  const drag = useRef<'in' | 'out' | 'seek' | null>(null)

  function snapVal(t: number): number {
    if (!snap || beats.length === 0) return t
    let best = t
    let bestD = 0.25 // snap within 0.25s
    for (const b of beats) {
      const d = Math.abs(b - t)
      if (d < bestD) {
        bestD = d
        best = b
      }
    }
    return best
  }

  async function findBeats(): Promise<void> {
    setFindingBeats(true)
    try {
      const r = await window.api.detectBeats(item.path)
      setBeats(r.beats)
      setBpm(r.bpm)
      setMarkerMsg(r.beats.length ? `Found ${r.beats.length} beats${r.bpm ? ` · ~${r.bpm} BPM` : ''}` : 'No clear beats found')
    } catch {
      setMarkerMsg('Beat detection failed')
    } finally {
      setFindingBeats(false)
    }
  }

  async function saveMarkers(): Promise<void> {
    if (!beats.length) return
    await window.api.saveMarkers(name.trim() || item.baseName, beats, bpm)
    setMarkerMsg(
      `Saved ${beats.length} markers to the tray folder. In After Effects: select your layer → File → Scripts → Run Script File → pick the .beats.jsx`
    )
  }

  // Reset when the clip changes.
  useEffect(() => {
    setDuration(0)
    setCurrent(0)
    setInPoint(0)
    setOutPoint(0)
    setPlaying(false)
    setStrip([])
    setLoadError(false)
    setName(item.suggestedName || item.baseName)
    setRenaming(false)
    setRenameNote('')
    setWave(null)
    setBeats([])
    setBpm(0)
    setMarkerMsg('')
    window.api.waveform(item.path).then(setWave)
    // Authoritative duration from ffmpeg — the media element can report
    // Infinity/NaN for audio & some streamed files, which breaks the timeline.
    window.api.mediaInfo(item.path).then((info) => {
      if (info.durationSec > 0) {
        setDuration((d) => (d > 0 ? d : info.durationSec))
        setOutPoint((o) => (o > 0 ? o : info.durationSec))
      }
    })
  }, [item.id])

  async function aiRename(): Promise<void> {
    setRenaming(true)
    setRenameNote('')
    try {
      const r = await window.api.nameClip(item, inPoint, outPoint)
      if (r?.name) setName(r.name)
      // The AI call failed (quota, session, network…): the name shown is an
      // offline fallback. Say so — never let it pass as an AI result.
      if (r?.error) setRenameNote(`Offline name — the AI couldn’t run: ${r.error}`)
      else onCreditUsed() // a real AI name spent a credit — refresh the chip
    } catch (e) {
      setRenameNote(e instanceof Error ? e.message : String(e))
    } finally {
      setRenaming(false)
    }
  }

  function onLoaded(): void {
    const raw = mediaRef.current?.duration ?? 0
    if (isFinite(raw) && raw > 0) {
      setDuration(raw)
      setOutPoint((o) => (o > 0 && o <= raw ? o : raw))
    } else {
      // Infinity/NaN duration (common for audio served over a custom protocol):
      // fall back to the ffmpeg-derived duration so the timeline still works.
      window.api.mediaInfo(item.path).then((info) => {
        if (info.durationSec > 0) {
          setDuration(info.durationSec)
          setOutPoint((o) => (o > 0 ? o : info.durationSec))
        }
      })
    }
  }

  // Build the filmstrip once we have a real duration (decoupled from onLoaded so
  // it still runs when duration arrives from the ffmpeg fallback).
  useEffect(() => {
    if (isVideo && duration > 0 && strip.length === 0) {
      window.api.filmstrip(item.path, duration, 10).then(setStrip)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, item.id])

  function timeFromClientX(clientX: number): number {
    const el = timelineRef.current
    if (!el || duration <= 0) return 0
    const r = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    return ratio * duration
  }

  function seek(t: number): void {
    if (mediaRef.current) mediaRef.current.currentTime = Math.min(duration, Math.max(0, t))
  }

  // global pointer move/up while dragging a handle or scrubbing
  useEffect(() => {
    function move(e: PointerEvent): void {
      if (!drag.current) return
      const raw = timeFromClientX(e.clientX)
      if (drag.current === 'in') setInPoint(Math.min(snapVal(raw), outPoint - 0.05))
      else if (drag.current === 'out') setOutPoint(Math.max(snapVal(raw), inPoint + 0.05))
      else if (drag.current === 'seek') seek(raw)
    }
    function up(): void {
      drag.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, inPoint, outPoint, snap, beats])

  function togglePlay(): void {
    const el = mediaRef.current
    if (!el) return
    if (el.paused) el.play()
    else el.pause()
  }

  function playSelection(): void {
    const el = mediaRef.current
    if (!el) return
    el.currentTime = inPoint
    el.play()
  }

  function onTimeUpdate(): void {
    const t = mediaRef.current?.currentTime || 0
    setCurrent(t)
    // stop at the out point when previewing the selection
    if (playing && t >= outPoint && outPoint > inPoint) {
      mediaRef.current?.pause()
      seek(outPoint)
    }
  }

  const pct = (t: number): string => `${duration > 0 ? (t / duration) * 100 : 0}%`
  const hasRange = outPoint > inPoint && (inPoint > 0.05 || outPoint < duration - 0.05)

  return (
    <div
      className="select-none"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === ' ') {
          e.preventDefault()
          togglePlay()
        } else if (e.key.toLowerCase() === 'i') setInPoint(Math.min(current, outPoint - 0.05))
        else if (e.key.toLowerCase() === 'o') setOutPoint(Math.max(current, inPoint + 0.05))
      }}
    >
      {/* Player */}
      <div className="overflow-hidden rounded-xl border border-borderSoft bg-black">
        {isVideo ? (
          <video
            ref={mediaRef}
            src={url}
            className="mx-auto max-h-[46vh] w-full bg-black object-contain"
            onLoadedMetadata={onLoaded}
            onTimeUpdate={onTimeUpdate}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            muted={muted}
            onError={() => setLoadError(true)}
            onClick={togglePlay}
          />
        ) : (
          <div className="flex h-44 items-center justify-center bg-gradient-to-b from-surface2 to-surface px-4">
            <audio
              ref={mediaRef}
              src={url}
              muted={muted}
              onLoadedMetadata={onLoaded}
              onTimeUpdate={onTimeUpdate}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onError={() => setLoadError(true)}
            />
            {wave ? (
              <img src={wave} alt="audio waveform" className="max-h-28 w-full object-contain opacity-90" />
            ) : (
              <div className="text-center">
                <div className="mb-2 flex items-end justify-center gap-0.5">
                  {Array.from({ length: 28 }).map((_, i) => (
                    <span
                      key={i}
                      className="w-1 rounded-full bg-mint/50"
                      style={{ height: `${8 + Math.abs(Math.sin(i * 1.3)) * 38}px` }}
                    />
                  ))}
                </div>
                <div className="font-mono text-xs text-faint">audio clip</div>
              </div>
            )}
          </div>
        )}
      </div>

      {loadError && (
        <div className="mt-2 rounded-lg border border-peach/30 bg-peach/5 px-3 py-2 text-xs text-peach">
          Couldn’t play this clip. The format may need a codec your system doesn’t have — you can still
          add the whole clip to the tray.
        </div>
      )}

      {/* Transport */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={togglePlay} className="btn-primary !px-4">
          {playing ? 'Pause' : 'Play'}
        </button>
        <button onClick={playSelection} className="btn" disabled={!(outPoint > inPoint)}>
          Play selection
        </button>
        <button onClick={() => setMuted((m) => !m)} className="btn">
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <div className="ml-auto font-mono text-xs text-muted">
          {fmt(current)} <span className="text-faint">/ {fmt(duration)}</span>
        </div>
      </div>

      {/* Timeline */}
      <div className="mt-3">
        <div
          ref={timelineRef}
          onPointerDown={(e) => {
            drag.current = 'seek'
            seek(timeFromClientX(e.clientX))
          }}
          className="relative h-20 cursor-pointer overflow-hidden rounded-lg border border-borderSoft bg-surface2"
        >
          {/* filmstrip background */}
          {strip.length > 0 && (
            <div className="absolute inset-0 flex">
              {strip.map((s, i) => (
                <img key={i} src={s} alt="" className="h-full flex-1 object-cover opacity-70" />
              ))}
            </div>
          )}
          {/* waveform overlay so peaks are visible & aligned to the timeline */}
          {wave && (
            <img
              src={wave}
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full object-fill opacity-60"
            />
          )}
          {/* dim outside selection */}
          <div className="absolute inset-y-0 left-0 bg-black/55" style={{ width: pct(inPoint) }} />
          <div
            className="absolute inset-y-0 right-0 bg-black/55"
            style={{ width: `${duration > 0 ? ((duration - outPoint) / duration) * 100 : 0}%` }}
          />
          {/* beat markers */}
          {beats.map((t, i) => (
            <div
              key={i}
              className="pointer-events-none absolute top-0 z-[5] h-2.5 w-px bg-peach"
              style={{ left: pct(t) }}
            />
          ))}
          {/* selection border */}
          <div
            className="absolute inset-y-0 border-x-2 border-mint"
            style={{ left: pct(inPoint), right: `${duration > 0 ? ((duration - outPoint) / duration) * 100 : 0}%` }}
          />
          {/* in handle (start) */}
          <div
            onPointerDown={(e) => {
              e.stopPropagation()
              drag.current = 'in'
            }}
            className="absolute inset-y-0 z-10 -ml-2.5 flex w-5 cursor-ew-resize items-center justify-center"
            style={{ left: pct(inPoint) }}
            title="Drag to set the start"
          >
            <div className="h-full w-1.5 bg-mint" />
            <div className="absolute grid h-7 w-4 place-items-center rounded-md bg-mint text-[10px] font-bold text-mint-ink shadow">
              ‹
            </div>
          </div>
          {/* out handle (end) */}
          <div
            onPointerDown={(e) => {
              e.stopPropagation()
              drag.current = 'out'
            }}
            className="absolute inset-y-0 z-10 -ml-2.5 flex w-5 cursor-ew-resize items-center justify-center"
            style={{ left: pct(outPoint) }}
            title="Drag to set the end"
          >
            <div className="h-full w-1.5 bg-mint" />
            <div className="absolute grid h-7 w-4 place-items-center rounded-md bg-mint text-[10px] font-bold text-mint-ink shadow">
              ›
            </div>
          </div>
          {/* playhead — grab the knob (or anywhere on the bar) to scrub */}
          <div
            onPointerDown={(e) => {
              e.stopPropagation()
              drag.current = 'seek'
              seek(timeFromClientX(e.clientX))
            }}
            className="absolute inset-y-0 z-20 -ml-2 w-4 cursor-ew-resize"
            style={{ left: pct(current) }}
          >
            <div className="mx-auto h-full w-0.5 bg-white" />
            <div className="absolute left-1/2 top-0 h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[9px] border-x-transparent border-t-white" />
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button onClick={() => setInPoint(Math.min(current, outPoint - 0.05))} className="btn !py-1.5">
            Set start ({fmt(inPoint)})
          </button>
          <button onClick={() => setOutPoint(Math.max(current, inPoint + 0.05))} className="btn !py-1.5">
            Set end ({fmt(outPoint)})
          </button>
          <span className="ml-auto text-faint">Keeping {fmt(Math.max(0, outPoint - inPoint))}</span>
        </div>

        {/* AI beat markers */}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button onClick={findBeats} disabled={findingBeats} className="btn !py-1.5">
            {findingBeats ? 'Analyzing beats…' : 'Find beats'}
          </button>
          {beats.length > 0 && (
            <>
              <label className="flex items-center gap-1.5 text-muted">
                <input
                  type="checkbox"
                  checked={snap}
                  onChange={(e) => setSnap(e.target.checked)}
                  className="h-3.5 w-3.5 accent-mint"
                />
                Snap to beats
              </label>
              <button onClick={saveMarkers} className="btn !py-1.5">
                Save markers
              </button>
            </>
          )}
          {markerMsg && <span className="ml-auto text-faint">{markerMsg}</span>}
        </div>
      </div>

      {/* Name this clip */}
      <div className="mt-4">
        <div className="mb-1 text-xs font-medium text-muted">Name for this clip</div>
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field font-mono text-sm"
            placeholder="type a name…"
          />
          <span className="text-xs text-faint">.{item.ext}</span>
          <button onClick={aiRename} disabled={renaming} className="btn whitespace-nowrap !py-2 text-xs">
            {renaming ? 'Naming…' : 'Rename with AI'}
          </button>
        </div>
        {renameNote && <div className="mt-1 text-[11px] text-peach">{renameNote}</div>}
        <div className="mt-1 text-[11px] text-faint">
          AI looks at the part you selected to name it (1 credit). You can also type your own.
        </div>
      </div>

      {/* Add to tray */}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() =>
            onAddToTray({ ...item, suggestedName: name.trim() || item.baseName }, { start: inPoint, end: outPoint })
          }
          disabled={!hasRange}
          className="btn-primary"
          title={hasRange ? '' : 'Move the start/end to select a section first'}
        >
          Add trimmed clip to tray
        </button>
        <button
          onClick={() => onAddToTray({ ...item, suggestedName: name.trim() || item.baseName })}
          className="btn"
        >
          Add whole clip to tray
        </button>
      </div>
      <div className="mt-2 text-[11px] text-faint">
        Tip: drag the white playhead (or click anywhere on the timeline) to scrub. Space = play/pause,
        I = set start, O = set end.
      </div>
    </div>
  )
}
