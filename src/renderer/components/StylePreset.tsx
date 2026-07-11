import React from 'react'
import { NamingStyle, NAMING_STYLES } from '../../shared/types'

interface Props {
  value: NamingStyle
  onChange: (s: NamingStyle) => void
}

export default function StylePreset({ value, onChange }: Props): React.ReactElement {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {NAMING_STYLES.map((s) => {
        const active = value === s.id
        return (
          <button
            key={s.id}
            onClick={() => onChange(s.id)}
            className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
              active
                ? 'border-mint bg-mint/10 shadow-glow'
                : 'border-borderSoft bg-surface2 hover:border-faint'
            }`}
          >
            <div className={`text-[13px] font-medium ${active ? 'text-mint' : 'text-text'}`}>
              {s.label}
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-faint">{s.hint}</div>
          </button>
        )
      })}
    </div>
  )
}
