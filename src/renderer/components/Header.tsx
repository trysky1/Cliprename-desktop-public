import React from 'react'
import logo from '../assets/logo.png'

interface Props {
  trayCount: number
  // Remaining AI credits today, or null while unknown. Shown as a quiet chip so
  // the cost of AI features is always visible — click opens Settings (usage +
  // upgrade live there).
  creditsLeft: number | null
  onOpenSettings: () => void
  onOpenTray: () => void
  onOpenLibrary: () => void
}

export default function Header({
  trayCount,
  creditsLeft,
  onOpenSettings,
  onOpenTray,
  onOpenLibrary
}: Props): React.ReactElement {
  return (
    <header className="flex items-center justify-between px-6 py-4">
      <div className="flex items-center gap-3">
        <img src={logo} alt="ClipRename" className="h-10 w-10 rounded-xl shadow-soft" />
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">ClipRename</div>
          <div className="text-xs text-faint">Tidy up your media folders</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {creditsLeft !== null && (
          <button
            onClick={onOpenSettings}
            className={`chip !py-1 text-[11px] ${creditsLeft <= 0 ? '!border-peach/40 !text-peach' : ''}`}
            title="AI credits left today — click for usage details and plans"
          >
            {creditsLeft <= 0 ? 'Out of AI names — tap to upgrade' : `${creditsLeft} AI names left today`}
          </button>
        )}
        <button
          onClick={onOpenLibrary}
          className="btn-ghost"
          title="Your library — everything you’ve named, searchable"
        >
          Library
        </button>
        <button
          onClick={onOpenTray}
          className={`btn-ghost ${trayCount > 0 ? '!text-mint' : ''}`}
          title="Your tray — drag clips into your editor"
        >
          Tray
          {trayCount > 0 && (
            <span className="ml-1 rounded-full bg-mint px-1.5 text-[11px] font-semibold text-mint-ink">
              {trayCount}
            </span>
          )}
        </button>
        <button onClick={onOpenSettings} className="btn-ghost" title="Settings">
          Settings
        </button>
      </div>
    </header>
  )
}
