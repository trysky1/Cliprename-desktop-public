import React, { useEffect, useState } from 'react'
import { kindForExt, MediaKind } from '../../shared/types'

// Self-loading thumbnail for any file path — video frame or image preview via
// the main process, with a kind icon fallback for audio/unknown. Results are
// cached for the app's lifetime so lists re-render instantly, and generation
// is capped at a few concurrent ffmpeg calls so a 500-clip folder doesn't
// spawn 500 processes at once.

const cache = new Map<string, string | null>()

let active = 0
const waiters: (() => void)[] = []
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  while (active >= 4) await new Promise<void>((r) => waiters.push(r))
  active++
  try {
    return await fn()
  } finally {
    active--
    waiters.shift()?.()
  }
}

export function kindOfPath(p: string): MediaKind {
  const ext = (p.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
  return kindForExt(ext)
}

interface Props {
  path: string
  kind?: MediaKind // derived from the extension when omitted
  className?: string // size/shape — defaults to a 36px rounded square
}

export default function MediaThumb({ path, kind, className }: Props): React.ReactElement {
  const k = kind ?? kindOfPath(path)
  const [url, setUrl] = useState<string | null>(cache.get(path) ?? null)

  useEffect(() => {
    setUrl(cache.get(path) ?? null)
    if (cache.has(path)) return
    if (k !== 'video' && k !== 'image') {
      cache.set(path, null)
      return
    }
    let gone = false
    void withSlot(() => window.api.thumb(path, k))
      .then((u) => {
        cache.set(path, u)
        if (!gone) setUrl(u)
      })
      .catch(() => cache.set(path, null))
    return () => {
      gone = true
    }
  }, [path, k])

  const box = `relative shrink-0 overflow-hidden bg-surface2 ${className ?? 'h-9 w-9 rounded-lg'}`
  if (url) {
    return (
      <span className={`${box} grid place-items-center`}>
        <img src={url} alt="" className="h-full w-full object-cover" />
        {k === 'video' && (
          <span className="absolute inset-0 grid place-items-center text-[10px] text-white/90 drop-shadow">
            ▶
          </span>
        )}
      </span>
    )
  }
  const label =
    k === 'audio' ? '♪' : (path.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'file').toUpperCase().slice(0, 4)
  return (
    <span
      className={`${box} grid place-items-center font-mono text-[9px] font-semibold ${
        k === 'audio' ? 'text-mint text-sm' : 'text-faint'
      }`}
    >
      {label}
    </span>
  )
}
