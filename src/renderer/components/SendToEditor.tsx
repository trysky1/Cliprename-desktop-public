import React, { useState } from 'react'
import { MediaItem, NleTarget } from '../../shared/types'

interface Props {
  items: MediaItem[]
  actionNaming: boolean
}

const TARGETS: { id: NleTarget; label: string; hint: string; ext: string }[] = [
  { id: 'fcpxml', label: 'Final Cut / DaVinci Resolve', hint: 'Opens an organized event (FCPXML)', ext: 'fcpxml' },
  { id: 'premiere', label: 'Adobe Premiere Pro', hint: 'Imports as named bins (XML)', ext: 'xml' }
]

function dateStamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Export an organized project file the editor opens directly — clips already
// named and sorted into bins. The wedge no other renamer has.
export default function SendToEditor({ items, actionNaming }: Props): React.ReactElement {
  const [target, setTarget] = useState<NleTarget>('fcpxml')
  const [groupBy, setGroupBy] = useState<'category' | 'action'>('category')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ path: string; count: number } | null>(null)
  const [error, setError] = useState('')

  const named = items.filter((i) => i.suggestedName)
  const ext = TARGETS.find((t) => t.id === target)?.ext ?? 'fcpxml'

  async function exportNow(): Promise<void> {
    setError('')
    setDone(null)
    const dest = await window.api.pickSaveFile(`ClipRename ${dateStamp()}.${ext}`)
    if (!dest) return
    setBusy(true)
    try {
      const res = await window.api.exportNle(named, { target, groupBy, destPath: dest })
      setDone(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {TARGETS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTarget(t.id)}
            aria-pressed={target === t.id}
            className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
              target === t.id
                ? 'border-mint bg-mint/10 shadow-glow'
                : 'border-borderSoft bg-surface2 hover:border-faint'
            }`}
          >
            <div className={`text-[13px] font-medium ${target === t.id ? 'text-mint' : 'text-text'}`}>
              {t.label}
            </div>
            <div className="mt-0.5 text-[11px] leading-snug text-faint">{t.hint}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Organize bins by</span>
        <div className="inline-flex rounded-lg border border-borderSoft bg-surface2 p-0.5">
          <button
            onClick={() => setGroupBy('category')}
            className={`rounded-md px-2.5 py-1 text-xs ${groupBy === 'category' ? 'bg-mint text-mint-ink' : 'text-muted'}`}
          >
            Category
          </button>
          <button
            onClick={() => actionNaming && setGroupBy('action')}
            disabled={!actionNaming}
            title={actionNaming ? '' : 'Turn on action naming to group by action'}
            className={`rounded-md px-2.5 py-1 text-xs ${
              groupBy === 'action' ? 'bg-mint text-mint-ink' : 'text-muted'
            } ${!actionNaming ? 'opacity-40' : ''}`}
          >
            Action
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={exportNow} disabled={busy || named.length === 0} className="btn-primary">
          {busy ? 'Exporting…' : `Export ${named.length} clips to your editor`}
        </button>
        {named.length === 0 && (
          <span className="text-xs text-faint">Suggest names first, then export.</span>
        )}
      </div>

      {done && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-mint/30 bg-mint/5 px-4 py-3 text-[12px] text-muted">
          <span>
            Wrote a project with <b className="text-mint">{done.count}</b> clips. Open it from your
            editor’s <span className="font-mono">File → Import</span>.
          </span>
          <button onClick={() => window.api.reveal(done.path)} className="btn !py-1 !px-2 text-[11px]">
            Show file
          </button>
        </div>
      )}
      {error && <div className="text-[12px] text-danger">{error}</div>}
    </div>
  )
}
