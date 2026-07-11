import React, { useState } from 'react'
import { MediaItem, SceneSplitResult } from '../../shared/types'

interface Props {
  items: MediaItem[]
  // Called with the produced clips so they land in the drag-out tray.
  onClips?: (clips: SceneSplitResult['clips']) => void
}

const SENSITIVITY: { id: number; label: string }[] = [
  { id: 0.3, label: 'More cuts' },
  { id: 0.4, label: 'Balanced' },
  { id: 0.6, label: 'Fewer cuts' }
]

// Split a long recording into one file per scene at detected cuts. Clips land
// in the tray, ready to drag into the editor.
export default function SceneSplit({ items, onClips }: Props): React.ReactElement {
  const videos = items.filter((i) => i.kind === 'video')
  const [selId, setSelId] = useState('')
  const [threshold, setThreshold] = useState(0.4)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SceneSplitResult | null>(null)
  const [error, setError] = useState('')

  const selected = videos.find((v) => v.id === selId) || videos[0]

  async function run(): Promise<void> {
    if (!selected) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const res = await window.api.splitScenes(
        selected.path,
        selected.suggestedName || selected.baseName,
        threshold
      )
      setResult(res)
      if (res.clips.length === 0) setError('No clear scene cuts found — try “More cuts”.')
      else onClips?.(res.clips)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (videos.length === 0) {
    return (
      <div className="rounded-xl border border-borderSoft bg-surface2/50 px-4 py-3 text-[12px] text-faint">
        Add a video to split it into scenes.
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-xl border border-borderSoft bg-surface2/50 p-4">
      <div className="text-[13px] font-medium text-text">Split a video into scenes</div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selected?.id}
          onChange={(e) => setSelId(e.target.value)}
          className="field !py-1.5 max-w-[280px] text-xs"
        >
          {videos.map((v) => (
            <option key={v.id} value={v.id}>
              {v.suggestedName || v.baseName}.{v.ext}
            </option>
          ))}
        </select>
        <div className="inline-flex rounded-lg border border-borderSoft bg-surface2 p-0.5">
          {SENSITIVITY.map((s) => (
            <button
              key={s.id}
              onClick={() => setThreshold(s.id)}
              className={`rounded-md px-2.5 py-1 text-xs ${threshold === s.id ? 'bg-mint text-mint-ink' : 'text-muted'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button onClick={run} disabled={busy} className="btn-primary !py-1.5 text-xs">
          {busy ? 'Finding scenes…' : 'Split into scenes'}
        </button>
      </div>

      {result && result.clips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-mint/30 bg-mint/5 px-3 py-2 text-[12px] text-muted">
          <span>
            Made <b className="text-mint">{result.clips.length}</b> scene{' '}
            {result.clips.length === 1 ? 'clip' : 'clips'} — they’re in your tray, ready to drag
            into your editor.
          </span>
          <button onClick={() => window.api.openPath(result.outputDir)} className="btn !py-1 !px-2 text-[11px]">
            Open folder
          </button>
        </div>
      )}
      {error && <div className="text-[12px] text-peach">{error}</div>}
    </div>
  )
}
