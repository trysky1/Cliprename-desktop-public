import React from 'react'
import { IconClapper } from './Icons'

interface Props {
  on: boolean
  onChange: (v: boolean) => void
  live: boolean
}

// Opt-in switch for action-based video naming. When on, videos are named by
// the primary action the subject performs (read from several frames).
export default function ActionToggle({ on, onChange, live }: Props): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all ${
        on ? 'border-mint bg-mint/10 shadow-glow' : 'border-borderSoft bg-surface2 hover:border-faint'
      }`}
    >
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          on ? 'bg-mint' : 'bg-faint/40'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-mint-ink transition-all ${
            on ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </span>
      <span className="min-w-0">
        <span
          className={`flex items-center gap-1.5 text-[13px] font-medium ${on ? 'text-mint' : 'text-text'}`}
        >
          <IconClapper size={15} /> Name videos by their action
        </span>
        <span className="block text-[11px] leading-snug text-faint">
          Reads several moments across each video to name the main action — e.g. “bicycle kick”,
          “flipping pancakes”.
          {!live && ' Sign in to your ClipRename account (Settings) to actually watch the video.'}
        </span>
      </span>
    </button>
  )
}
