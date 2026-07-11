import React from 'react'

interface Props {
  n: number
  title: string
  desc?: string
  done?: boolean
  disabled?: boolean
  children?: React.ReactNode
}

// Numbered step shell used by the guided flows. Shows a mint badge with the
// step number (✓ when done) and dims its content until it's unlocked.
export default function Step({ n, title, desc, done, disabled, children }: Props): React.ReactElement {
  return (
    <section
      className={`card space-y-3 p-5 transition-opacity ${disabled ? 'pointer-events-none opacity-40' : ''}`}
      aria-disabled={disabled}
    >
      <div className="flex items-start gap-3">
        <span
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-[13px] font-bold ${
            done ? 'bg-mint text-mint-ink' : disabled ? 'bg-surface2 text-faint' : 'bg-mint/15 text-mint'
          }`}
        >
          {done ? '✓' : n}
        </span>
        <div className="min-w-0">
          <div className="section-title">{title}</div>
          {desc && <div className="section-desc">{desc}</div>}
        </div>
      </div>
      {children && <div className="pl-10">{children}</div>}
    </section>
  )
}
