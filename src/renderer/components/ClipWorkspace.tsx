import React, { useEffect, useState } from 'react'
import { MediaItem } from '../../shared/types'
import VideoEditor from './VideoEditor'
import ImageEditor from './ImageEditor'

interface Props {
  items: MediaItem[]
  thumbs: Record<string, string>
  onAddToTray: (item: MediaItem, range?: { start: number; end: number }) => void
  onAddEditedImage: (item: MediaItem, edits: { crop?: { x: number; y: number; w: number; h: number }; rotate: number; flipH: boolean }) => void
  // Refresh the header credit chip after an in-editor "Rename with AI" spends one.
  onCreditUsed: () => void
}

export default function ClipWorkspace({
  items,
  thumbs,
  onAddToTray,
  onAddEditedImage,
  onCreditUsed
}: Props): React.ReactElement {
  const [sub, setSub] = useState<'av' | 'img'>('av')
  const av = items.filter((i) => i.kind === 'video' || i.kind === 'audio')
  const imgs = items.filter((i) => i.kind === 'image')
  const list = sub === 'av' ? av : imgs
  const [selId, setSelId] = useState<string | null>(null)

  useEffect(() => {
    if (list.length && !list.find((i) => i.id === selId)) setSelId(list[0].id)
    if (list.length === 0) setSelId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub, items.length])

  const selected = list.find((i) => i.id === selId) || null

  return (
    <div className="space-y-4">
      {/* sub-tabs */}
      <div className="inline-flex rounded-xl border border-border bg-surface2 p-1">
        <SubTab on={sub === 'av'} onClick={() => setSub('av')} label={`Video & audio (${av.length})`} />
        <SubTab on={sub === 'img'} onClick={() => setSub('img')} label={`Images (${imgs.length})`} />
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-borderSoft bg-surface2 px-4 py-10 text-center text-sm text-faint">
          {sub === 'av' ? 'No video or audio clips loaded.' : 'No images loaded.'}
        </div>
      ) : (
        <>
          {selected &&
            (sub === 'av' ? (
              <VideoEditor key={selected.id} item={selected} onAddToTray={onAddToTray} onCreditUsed={onCreditUsed} />
            ) : (
              <ImageEditor key={selected.id} item={selected} onAddEdited={onAddEditedImage} onCreditUsed={onCreditUsed} />
            ))}

          {/* clip bin */}
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted">
              {sub === 'av' ? 'Your clips' : 'Your images'}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {list.map((it) => (
                <button
                  key={it.id}
                  onClick={() => setSelId(it.id)}
                  title={it.suggestedName ? `${it.suggestedName}.${it.ext}` : it.originalName}
                  className={`group relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border transition-colors ${
                    selId === it.id ? 'border-mint' : 'border-borderSoft hover:border-faint'
                  }`}
                >
                  {thumbs[it.id] ? (
                    <img src={thumbs[it.id]} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full w-full place-items-center bg-surface2 font-mono text-[10px] font-semibold text-faint">
                      {(it.ext || 'file').toUpperCase().slice(0, 4)}
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-[9px] text-text">
                    {it.suggestedName || it.baseName}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function SubTab({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }): React.ReactElement {
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
