import React from 'react'
import { IconBot, IconScissors, IconSparkles } from './Icons'

interface Props {
  onPick: (mode: 'auto' | 'clip' | 'agent') => void
  onDismiss: () => void
}

// First-run welcome: explains the three workflows in plain language and lets
// the user jump straight into one. Shown once (settings.welcomed).
export default function Welcome({ onPick, onDismiss }: Props): React.ReactElement {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="card w-full max-w-2xl space-y-5 p-7">
        <div className="text-center">
          <div className="font-display text-2xl font-semibold text-text">Welcome to ClipRename</div>
          <div className="mx-auto mt-1 max-w-md text-sm text-muted">
            Point it at your footage and it gives every clip a clean, descriptive name — then helps
            you sort, trim, and drag clips straight into your editor. Pick what you want to do:
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <WorkflowCard
            icon={<IconSparkles size={20} />}
            title="Clean up names"
            desc="Drop in a messy folder and get tidy AI names for every file. Review first, undo anytime."
            onClick={() => onPick('auto')}
          />
          <WorkflowCard
            icon={<IconScissors size={20} />}
            title="Clipping"
            desc="Trim clips to the good part and drag them straight into Premiere, AE, or DaVinci."
            onClick={() => onPick('clip')}
          />
          <WorkflowCard
            icon={<IconBot size={20} />}
            title="Folder Agent"
            desc="Point it at a folder — it renames (and can sort) the videos and audio in it for you."
            onClick={() => onPick('agent')}
          />
        </div>

        <div className="text-center">
          <button onClick={onDismiss} className="btn-ghost text-xs">
            Skip — just show me the app
          </button>
        </div>
      </div>
    </div>
  )
}

function WorkflowCard({
  icon,
  title,
  desc,
  onClick
}: {
  icon: React.ReactNode
  title: string
  desc: string
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-borderSoft bg-surface2 px-4 py-4 text-left transition-all hover:border-mint hover:bg-mint/5 hover:shadow-glow focus-visible:border-mint focus-visible:shadow-glow"
    >
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-mint/10 text-mint">{icon}</span>
      <div className="mt-2 text-[14px] font-semibold text-text">{title}</div>
      <div className="mt-1 text-[11.5px] leading-snug text-faint">{desc}</div>
    </button>
  )
}
