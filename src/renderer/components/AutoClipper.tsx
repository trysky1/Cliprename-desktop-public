import React, { useState } from 'react'
import { MediaItem } from '../../shared/types'

interface Props {
  items: MediaItem[]
  // Called with the kept clips so they land in the drag-out tray.
  onClips?: (clips: { path: string; startSec: number; endSec: number }[]) => void
}

type Mode = 'silence' | 'still'
type Strength = 'gentle' | 'balanced' | 'aggressive'

const STRENGTHS: { id: Strength; label: string; hint: string }[] = [
  { id: 'gentle', label: 'Gentle', hint: 'only long dead air' },
  { id: 'balanced', label: 'Balanced', hint: 'pauses & dead air' },
  { id: 'aggressive', label: 'Tight', hint: 'jump-cut style' }
]

function fmt(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`
  return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`
}

// One-click "cut the useless parts": finds silence (or frozen picture), keeps
// the good segments, and stages them in the tray ready to drag into an editor.
export default function AutoClipper({ items, onClips }: Props): React.ReactElement | null {
  const media = items.filter((i) => i.kind === 'video' || i.kind === 'audio')
  const [selId, setSelId] = useState('')
  const [mode, setMode] = useState<Mode>('silence')
  const [strength, setStrength] = useState<Strength>('balanced')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ count: number; removedSec: number; totalSec: number; outputDir: string } | null>(null)
  const [note, setNote] = useState('')

  const selected = media.find((v) => v.id === selId) || media[0]
  if (media.length === 0) return null

  async function run(): Promise<void> {
    if (!selected) return
    setBusy(true)
    setNote('')
    setResult(null)
    try {
      const res = await window.api.autoClip(
        selected.path,
        selected.suggestedName || selected.baseName,
        { mode: selected.kind === 'audio' ? 'silence' : mode, strength }
      )
      if (res.clips.length === 0) {
        const a = res.analysis
        if (res.removedSec >= res.totalSec && res.totalSec > 0) {
          setNote('The whole clip looks like dead air at this setting — try Gentle.')
        } else if (a && a.mode === 'silence' && !a.hasAudio) {
          setNote(
            selected.kind === 'audio'
              ? 'This file has no readable audio.'
              : 'This video has no audio track — switch to “Still picture” mode to cut by frozen picture instead.'
          )
        } else if (a && a.mode === 'silence') {
          setNote(
            `No dead air found — this clip has sound almost the whole way through. Try “Tight” for shorter pauses${selected.kind !== 'audio' ? ', or “Still picture” mode' : ''}.`
          )
        } else {
          setNote('No frozen parts found — the picture keeps moving. Try Tight, or “Silence” mode.')
        }
        return
      }
      setResult({ count: res.clips.length, removedSec: res.removedSec, totalSec: res.totalSec, outputDir: res.outputDir })
      onClips?.(res.clips)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-mint/25 bg-mint/[0.04] p-4">
      <div>
        <div className="text-[13px] font-medium text-text">
          Auto clipper <span className="chip ml-1 align-middle !py-0.5 !px-1.5 text-[10px]">new</span>
        </div>
        <div className="text-[11px] text-faint">
          Cuts out the useless parts — silence or frozen picture — and drops only the good
          segments into your tray.
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selected?.id}
          onChange={(e) => setSelId(e.target.value)}
          className="field !py-1.5 max-w-[260px] text-xs"
        >
          {media.map((v) => (
            <option key={v.id} value={v.id}>
              {v.suggestedName || v.baseName}.{v.ext}
            </option>
          ))}
        </select>

        {selected?.kind !== 'audio' && (
          <div className="inline-flex rounded-lg border border-borderSoft bg-surface2 p-0.5">
            <button
              onClick={() => setMode('silence')}
              className={`rounded-md px-2.5 py-1 text-xs ${mode === 'silence' ? 'bg-mint text-mint-ink' : 'text-muted'}`}
            >
              Silence
            </button>
            <button
              onClick={() => setMode('still')}
              className={`rounded-md px-2.5 py-1 text-xs ${mode === 'still' ? 'bg-mint text-mint-ink' : 'text-muted'}`}
            >
              Still picture
            </button>
          </div>
        )}

        <div className="inline-flex rounded-lg border border-borderSoft bg-surface2 p-0.5">
          {STRENGTHS.map((s) => (
            <button
              key={s.id}
              onClick={() => setStrength(s.id)}
              title={s.hint}
              className={`rounded-md px-2.5 py-1 text-xs ${strength === s.id ? 'bg-mint text-mint-ink' : 'text-muted'}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <button onClick={run} disabled={busy} className="btn-primary !py-1.5 text-xs">
          {busy ? 'Listening for the good parts…' : 'Cut the useless parts'}
        </button>
      </div>

      {result && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-mint/30 bg-mint/5 px-3 py-2 text-[12px] text-muted">
          <span>
            Kept <b className="text-mint">{result.count}</b> good{' '}
            {result.count === 1 ? 'segment' : 'segments'} · removed{' '}
            <b className="text-peach">{fmt(result.removedSec)}</b> of {fmt(result.totalSec)} — all in
            your tray.
          </span>
          <button onClick={() => window.api.openPath(result.outputDir)} className="btn !py-1 !px-2 text-[11px]">
            Open folder
          </button>
        </div>
      )}
      {note && <div className="text-[12px] text-peach">{note}</div>}
    </div>
  )
}
