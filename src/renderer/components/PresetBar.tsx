import React, { useEffect, useState } from 'react'
import { AppSettings, Preset } from '../../shared/types'

interface Props {
  settings: AppSettings
  onApply: (patch: Partial<AppSettings>) => void
}

function newId(): string {
  return 'ps' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
}

// Saved naming/organizing recipes — one click re-applies a whole setup
// (style + organize + copy/move + action naming).
export default function PresetBar({ settings, onApply }: Props): React.ReactElement {
  const [presets, setPresets] = useState<Preset[]>([])
  const [naming, setNaming] = useState(false)
  const [draftName, setDraftName] = useState('')

  useEffect(() => {
    window.api.presetsAll().then(setPresets)
  }, [])

  function apply(p: Preset): void {
    onApply({
      style: p.style,
      organizeByCategory: p.organizeByCategory,
      defaultMode: p.defaultMode,
      actionNaming: p.actionNaming
    })
  }

  async function save(): Promise<void> {
    const name = draftName.trim()
    if (!name) return
    const preset: Preset = {
      id: newId(),
      name,
      style: settings.style,
      organizeByCategory: settings.organizeByCategory,
      defaultMode: settings.defaultMode,
      actionNaming: settings.actionNaming
    }
    setPresets(await window.api.presetSave(preset))
    setNaming(false)
    setDraftName('')
  }

  async function remove(id: string): Promise<void> {
    setPresets(await window.api.presetDelete(id))
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-borderSoft bg-surface2/50 px-3 py-2">
      <span className="text-[11px] font-medium uppercase tracking-wide text-faint">Presets</span>
      {presets.length === 0 && !naming && (
        <span className="text-[11px] text-faint">Save your current setup to reuse it later.</span>
      )}
      {presets.map((p) => (
        <span key={p.id} className="group inline-flex items-center">
          <button
            onClick={() => apply(p)}
            className="chip !py-1 !px-2.5 hover:border-mint hover:text-mint"
            title={`${p.style} · ${p.organizeByCategory ? 'organized' : 'flat'} · ${p.defaultMode}${p.actionNaming ? ' · action' : ''}`}
          >
            {p.name}
          </button>
          <button
            onClick={() => remove(p.id)}
            className="ml-0.5 text-faint opacity-0 transition-opacity group-hover:opacity-100"
            title="Delete preset"
          >
            ✕
          </button>
        </span>
      ))}

      <span className="ml-auto inline-flex items-center gap-2">
        {naming ? (
          <>
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              placeholder="Preset name"
              className="field !py-1 max-w-[140px] text-xs"
            />
            <button onClick={save} className="btn !py-1 !px-2 text-[11px]">
              Save
            </button>
            <button onClick={() => setNaming(false)} className="btn-ghost !py-1 !px-2 text-[11px]">
              Cancel
            </button>
          </>
        ) : (
          <button onClick={() => setNaming(true)} className="btn-ghost !py-1 !px-2 text-[11px]">
            + Save current
          </button>
        )}
      </span>
    </div>
  )
}
