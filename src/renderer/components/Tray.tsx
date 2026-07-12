import { useEscape } from '../lib/useEscape'
import React, { useEffect, useRef, useState } from 'react'
import { TrayItem } from '../../shared/types'

function TrayPreview({ item }: { item: TrayItem }): React.ReactElement {
  const url = window.api.clipUrl(item.stagedPath)
  if (item.kind === 'image') {
    return (
      <img src={url} alt="" className="h-12 w-16 shrink-0 rounded-md border border-borderSoft object-cover" />
    )
  }
  if (item.kind === 'video') return <VideoPreview url={url} />
  if (item.kind === 'audio') return <AudioPreview url={url} />
  return (
    <div className="grid h-12 w-16 shrink-0 place-items-center rounded-md border border-borderSoft bg-surface2 font-mono text-[9px] font-semibold text-faint">
      {(item.label.split('.').pop() || 'file').toUpperCase().slice(0, 4)}
    </div>
  )
}

function VideoPreview({ url }: { url: string }): React.ReactElement {
  const ref = useRef<HTMLVideoElement>(null)
  return (
    <video
      ref={ref}
      src={url}
      preload="metadata"
      playsInline
      onLoadedMetadata={(e) => {
        try {
          e.currentTarget.currentTime = 0.1
        } catch {
          /* ignore */
        }
      }}
      onMouseEnter={() => {
        const v = ref.current
        if (v) {
          v.currentTime = 0
          v.play().catch(() => {})
        }
      }}
      onMouseLeave={() => {
        const v = ref.current
        if (v) {
          v.pause()
          v.currentTime = 0.1
        }
      }}
      className="h-12 w-16 shrink-0 rounded-md border border-borderSoft bg-black object-cover"
      title="Hover to preview"
    />
  )
}

function AudioPreview({ url }: { url: string }): React.ReactElement {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  return (
    <div className="grid h-12 w-16 shrink-0 place-items-center rounded-md border border-borderSoft bg-surface2">
      <audio
        ref={ref}
        src={url}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button
        onClick={(e) => {
          e.stopPropagation()
          const a = ref.current
          if (!a) return
          if (a.paused) a.play().catch(() => {})
          else a.pause()
        }}
        className="rounded px-2 py-1 text-[11px] font-medium text-mint hover:bg-mint/10"
      >
        {playing ? 'Pause' : 'Play'}
      </button>
    </div>
  )
}

interface Props {
  open: boolean
  items: TrayItem[]
  trayDir: string
  onClose: () => void
  onRemove: (id: string) => void
  onClear: () => void
  onReveal: () => void
  onChangeFolder: () => void
}

export default function Tray({
  open,
  items,
  trayDir,
  onClose,
  onRemove,
  onClear,
  onReveal,
  onChangeFolder
}: Props): React.ReactElement | null {
  const [folder, setFolder] = useState('')

  useEscape(onClose)

  // Refetch on trayDir change too — after "Change", the session folder moves
  // and dragging the old one would miss everything staged afterwards.
  useEffect(() => {
    if (open) window.api.trayFolder().then(setFolder)
  }, [open, trayDir])

  if (!open) return null

  function dragItems(paths: string[]): (e: React.DragEvent) => void {
    return (e) => {
      e.preventDefault()
      if (paths.length) window.api.startDrag(paths)
    }
  }

  const allPaths = items.map((i) => i.stagedPath)
  // Drag the whole session folder so it imports as a single bin (Premiere/AE) —
  // unless some clips were staged under an older folder (tray dir changed
  // mid-session), in which case drag the files themselves so nothing is missed.
  const sep = folder.includes('\\') ? '\\' : '/'
  const allInFolder = folder && allPaths.every((p) => p.startsWith(folder + sep))
  const dragAll = (e: React.DragEvent): void => {
    e.preventDefault()
    window.api.startDrag(allInFolder ? [folder] : allPaths)
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <aside
        onClick={(e) => e.stopPropagation()}
        className="relative flex h-full w-[380px] flex-col border-l border-border bg-surface shadow-soft"
      >
        <div className="flex items-center justify-between border-b border-borderSoft px-5 py-4">
          <div>
            <div className="section-title">Your tray</div>
            <div className="section-desc">Drag these straight into your editor — no exporting.</div>
          </div>
          <button onClick={onClose} className="btn-ghost text-lg">
            ✕
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-borderSoft px-5 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-faint">Saving clips to</div>
            <div className="truncate text-xs text-muted">{trayDir || 'Default (app storage)'}</div>
          </div>
          <button onClick={onChangeFolder} className="btn shrink-0 !py-1.5 !px-3 text-xs">
            Change
          </button>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-faint">
            <div>Your tray is empty.</div>
            <div className="text-xs">
              Add clips with the <span className="text-mint">Add to tray</span> button, or trim them in
              the Clipping tab. Then drag them into Premiere, DaVinci, etc.
            </div>
          </div>
        ) : (
          <>
            <div
              draggable
              onDragStart={dragAll}
              className="m-4 cursor-grab rounded-xl border-2 border-dashed border-mint/50 bg-mint/5 px-4 py-3 text-center active:cursor-grabbing"
              title="Drag all clips into your editor as one folder"
            >
              <div className="text-sm font-medium text-mint">
                Drag all {items.length} into your editor
              </div>
              <div className="mt-0.5 text-[11px] text-faint">
                Drops in as one folder — imports as a bin, full quality
              </div>
            </div>

            <div className="flex-1 space-y-1.5 overflow-auto px-4 pb-4">
              {items.map((it) => (
                <div
                  key={it.id}
                  draggable
                  onDragStart={dragItems([it.stagedPath])}
                  className="group flex cursor-grab items-center gap-3 rounded-xl border border-borderSoft bg-surface2 px-3 py-2.5 active:cursor-grabbing hover:border-mint/40"
                  title="Drag me into your editor"
                >
                  <TrayPreview item={it} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs text-text">{it.label}</div>
                    <div className="text-[11px] text-faint">
                      {it.trimmed ? 'Trimmed · ready to drag' : 'Ready to drag'}
                    </div>
                  </div>
                  <button
                    onClick={() => onRemove(it.id)}
                    title="Remove from tray"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-faint opacity-60 transition-all hover:bg-peach/10 hover:text-peach group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between border-t border-borderSoft px-4 py-3">
              <button onClick={onReveal} className="btn-ghost text-xs">
                Open tray folder
              </button>
              <button onClick={onClear} className="btn-ghost text-xs hover:text-peach">
                Clear tray
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}
