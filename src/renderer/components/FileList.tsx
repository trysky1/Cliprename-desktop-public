import React, { useMemo, useState } from 'react'
import { MediaItem, MediaKind } from '../../shared/types'
import { KIND_META } from '../lib/kinds'

interface Props {
  items: MediaItem[]
  analyzing: boolean
  thumbs: Record<string, string>
  onRemove: (id: string) => void
  onClear: () => void
  onAddToTray: (item: MediaItem) => void
}

type Filter = 'all' | MediaKind

export default function FileList({
  items,
  analyzing,
  thumbs,
  onRemove,
  onClear,
  onAddToTray
}: Props): React.ReactElement {
  const [filter, setFilter] = useState<Filter>('all')
  const [preview, setPreview] = useState<MediaItem | null>(null)

  const counts = useMemo(() => {
    const c: Record<MediaKind, number> = { video: 0, audio: 0, image: 0, other: 0 }
    items.forEach((i) => (c[i.kind] += 1))
    return c
  }, [items])

  const shown = filter === 'all' ? items : items.filter((i) => i.kind === filter)

  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: `All ${items.length}` },
    ...(['video', 'audio', 'image', 'other'] as MediaKind[])
      .filter((k) => counts[k] > 0)
      .map((k) => ({ key: k as Filter, label: `${KIND_META[k].label} ${counts[k]}` }))
  ]

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === c.key
                  ? 'bg-mint text-mint-ink'
                  : 'bg-surface2 text-muted hover:text-text border border-borderSoft'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        {items.length > 0 && (
          <button
            onClick={onClear}
            className="shrink-0 rounded-full border border-borderSoft px-3 py-1 text-xs text-muted transition-colors hover:border-peach/50 hover:text-peach"
            title="Remove every file from the list and start over"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="max-h-[42vh] space-y-1.5 overflow-auto pr-1">
        {shown.map((it) => (
          <Row
            key={it.id}
            item={it}
            analyzing={analyzing}
            thumb={thumbs[it.id]}
            onRemove={onRemove}
            onAddToTray={onAddToTray}
            onPreview={setPreview}
          />
        ))}
        {shown.length === 0 && (
          <div className="rounded-xl border border-borderSoft bg-surface px-3 py-6 text-center text-xs text-faint">
            No files here.
          </div>
        )}
      </div>

      {preview && <PreviewOverlay item={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}

function Row({
  item,
  analyzing,
  thumb,
  onRemove,
  onAddToTray,
  onPreview
}: {
  item: MediaItem
  analyzing: boolean
  thumb?: string
  onRemove: (id: string) => void
  onAddToTray: (item: MediaItem) => void
  onPreview: (item: MediaItem) => void
}): React.ReactElement {
  const loading = analyzing && item.status !== 'done' && item.status !== 'error'
  return (
    <div className="group flex items-center gap-3 rounded-xl border border-borderSoft bg-surface px-3 py-2.5">
      <Thumb item={item} thumb={thumb} onPreview={onPreview} />
      <span className="sr-only">{KIND_META[item.kind].label}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs text-faint line-through decoration-faint/40">
          {item.originalName}
        </div>
        {loading ? (
          <div className="mt-1 h-3.5 w-40 rounded skeleton" />
        ) : item.status === 'error' ? (
          <div className="truncate text-xs text-peach">⚠ {item.error || 'Could not name this file'}</div>
        ) : item.suggestedName ? (
          <div className="truncate font-mono text-[13px] text-text">
            {item.suggestedName}
            <span className="text-faint">.{item.ext}</span>
          </div>
        ) : (
          <div className="text-xs text-faint">Not named yet</div>
        )}
      </div>
      {item.category && !loading && <span className="chip shrink-0">{item.category}</span>}
      <button
        onClick={() => onAddToTray(item)}
        title="Add to tray (drag into your editor later)"
        className="shrink-0 rounded-lg border border-borderSoft px-2 py-1 text-[11px] text-muted opacity-0 transition-all hover:border-mint/50 hover:text-mint group-hover:opacity-100"
      >
        Add to tray
      </button>
      <button
        onClick={() => onRemove(item.id)}
        title="Remove this file from the list"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-faint opacity-0 transition-all hover:bg-peach/10 hover:text-peach group-hover:opacity-100"
      >
        ✕
      </button>
    </div>
  )
}

function Thumb({
  item,
  thumb,
  onPreview
}: {
  item: MediaItem
  thumb?: string
  onPreview: (item: MediaItem) => void
}): React.ReactElement {
  const [hover, setHover] = useState(false)
  const url = window.api.clipUrl(item.path)
  const previewable = item.kind !== 'other'

  const base = thumb ? (
    <img src={thumb} alt="" className="h-full w-full object-cover" />
  ) : item.kind === 'image' ? (
    <img src={url} alt="" className="h-full w-full object-cover" />
  ) : (
    <div className="grid h-full w-full place-items-center font-mono text-[10px] font-semibold text-faint">
      {(item.ext || 'file').toUpperCase().slice(0, 4)}
    </div>
  )

  return (
    <button
      type="button"
      disabled={!previewable}
      onClick={() => previewable && onPreview(item)}
      onMouseEnter={() => item.kind === 'video' && setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={previewable ? 'Click to preview' : undefined}
      className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-borderSoft bg-surface2 disabled:cursor-default"
    >
      {base}
      {hover && item.kind === 'video' && (
        <video
          src={url}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {(item.kind === 'video' || item.kind === 'audio') && (
        <span className="pointer-events-none absolute bottom-0.5 right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-black/70 text-[7px] text-white">
          ▶
        </span>
      )}
    </button>
  )
}

// Lightbox preview: real playback for video (with sound) & audio, full image.
function PreviewOverlay({
  item,
  onClose
}: {
  item: MediaItem
  onClose: () => void
}): React.ReactElement {
  const url = window.api.clipUrl(item.path)
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[82vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-surface p-3 shadow-soft"
      >
        <div className="mb-2 flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate font-mono text-xs text-muted">
            {item.suggestedName ? `${item.suggestedName}.${item.ext}` : item.originalName}
          </div>
          <button onClick={onClose} className="btn-ghost !px-2 !py-1" title="Close preview">
            ✕
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center">
          {item.kind === 'video' ? (
            <video
              src={url}
              controls
              autoPlay
              className="max-h-[68vh] w-full rounded-lg bg-black object-contain"
            />
          ) : item.kind === 'image' ? (
            <img src={url} alt="" className="max-h-[68vh] w-full rounded-lg object-contain" />
          ) : item.kind === 'audio' ? (
            <div className="w-full px-4 py-8">
              <audio src={url} controls autoPlay className="w-full" />
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-faint">
              No preview available for .{item.ext} files.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
