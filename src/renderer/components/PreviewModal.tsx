import React, { useMemo, useState } from 'react'
import { ApplyMode, MediaItem } from '../../shared/types'
import { useEscape } from '../lib/useEscape'

interface Props {
  items: MediaItem[]
  thumbs: Record<string, string>
  defaultMode: ApplyMode
  organizeByCategory: boolean
  outputDir: string
  onPickOutput: () => void
  onClose: () => void
  onApply: (edited: MediaItem[], mode: ApplyMode, organize: boolean) => void
  applying: boolean
}

export default function PreviewModal({
  items,
  thumbs,
  defaultMode,
  organizeByCategory,
  outputDir,
  onPickOutput,
  onClose,
  onApply,
  applying
}: Props): React.ReactElement {
  useEscape(onClose)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<ApplyMode>(defaultMode)
  const [organize, setOrganize] = useState(organizeByCategory)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  const included = useMemo(() => items.filter((i) => !excluded.has(i.id)), [items, excluded])

  function toggle(id: string): void {
    setExcluded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function nameOf(it: MediaItem): string {
    return (edits[it.id] ?? it.suggestedName ?? it.baseName).trim()
  }

  function applyNow(): void {
    onApply(
      included.map((it) => ({ ...it, suggestedName: nameOf(it) })),
      mode,
      organize
    )
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="card flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-borderSoft px-6 py-4">
          <div>
            <div className="section-title">Review the changes</div>
            <div className="section-desc">
              Nothing changes until you press apply. Edit any name, or untick files to skip them.
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost text-lg">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-1.5 overflow-auto px-4 py-3">
          {items.map((it) => {
            const skip = excluded.has(it.id)
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
                {thumbs[it.id] ? (
                  <img
                    src={thumbs[it.id]}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-lg border border-borderSoft object-cover"
                  />
                ) : (
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface2 font-mono text-[9px] font-semibold text-faint">
                    {(it.ext || 'file').toUpperCase().slice(0, 4)}
                  </span>
                )}
                <span className="w-36 shrink-0 truncate font-mono text-xs text-faint line-through">
                  {it.originalName}
                </span>
                <span className="text-faint">→</span>
                <div className="flex flex-1 items-center gap-1">
                  <input
                    value={nameOf(it)}
                    onChange={(e) => setEdits((p) => ({ ...p, [it.id]: e.target.value }))}
                    className="field !py-1.5 font-mono text-xs"
                  />
                  <span className="text-xs text-faint">.{it.ext}</span>
                </div>
              </div>
            )
          })}
        </div>

        <div className="space-y-4 border-t border-borderSoft px-6 py-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div>
              <div className="mb-1 text-xs font-medium text-muted">What to do with originals</div>
              <div className="inline-flex rounded-xl border border-border p-1">
                <Toggle on={mode === 'copy'} onClick={() => setMode('copy')} label="Keep & copy" />
                <Toggle on={mode === 'move'} onClick={() => setMode('move')} label="Move" />
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={organize}
                onChange={(e) => setOrganize(e.target.checked)}
                className="h-4 w-4 accent-mint"
              />
              Sort into folders by type
            </label>
          </div>

          <div>
            <div className="mb-1 text-xs font-medium text-muted">Save the tidy copy to</div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={outputDir || 'Choose a folder…'}
                className="field !py-2 text-xs text-muted"
              />
              <button onClick={onPickOutput} className="btn shrink-0 !py-2 text-xs">
                Browse
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-faint">
              {included.length} of {items.length} files selected
            </span>
            <div className="flex gap-2">
              <button onClick={onClose} className="btn">
                Cancel
              </button>
              <button
                onClick={applyNow}
                disabled={applying || !outputDir || included.length === 0}
                className="btn-primary"
              >
                {applying ? (
                  <>
                    <Spinner /> Organizing…
                  </>
                ) : (
                  `Apply to ${included.length} files`
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
        on ? 'bg-mint text-mint-ink' : 'text-muted hover:text-text'
      }`}
    >
      {label}
    </button>
  )
}

function Spinner(): React.ReactElement {
  return (
    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-mint-ink/30 border-t-mint-ink" />
  )
}
