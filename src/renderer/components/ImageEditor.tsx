import React, { useRef, useState } from 'react'
import { MediaItem } from '../../shared/types'

interface Crop {
  x: number
  y: number
  w: number
  h: number
}

interface Props {
  item: MediaItem
  onAddEdited: (
    item: MediaItem,
    edits: { crop?: Crop; rotate: number; flipH: boolean }
  ) => void
  onCreditUsed: () => void
}

export default function ImageEditor({ item, onAddEdited, onCreditUsed }: Props): React.ReactElement {
  const url = window.api.clipUrl(item.path)
  const imgRef = useRef<HTMLImageElement>(null)
  const [rotate, setRotate] = useState(0)
  const [flipH, setFlipH] = useState(false)
  const [crop, setCrop] = useState<Crop | null>(null)
  const [name, setName] = useState(item.suggestedName || item.baseName)
  const [renaming, setRenaming] = useState(false)
  const [renameNote, setRenameNote] = useState('')
  const draw = useRef<{ x: number; y: number } | null>(null)

  async function aiRename(): Promise<void> {
    setRenaming(true)
    setRenameNote('')
    try {
      const r = await window.api.nameClip(item)
      if (r?.name) setName(r.name)
      // The AI call failed (quota, session, network…): the name shown is an
      // offline fallback. Say so — never let it pass as an AI result.
      if (r?.error) setRenameNote(`Offline name — the AI couldn’t run: ${r.error}`)
      else onCreditUsed() // a real AI name spent a credit — refresh the chip
    } catch (e) {
      setRenameNote(e instanceof Error ? e.message : String(e))
    } finally {
      setRenaming(false)
    }
  }

  function rel(clientX: number, clientY: number): { x: number; y: number } {
    const r = imgRef.current!.getBoundingClientRect()
    return {
      x: Math.min(r.width, Math.max(0, clientX - r.left)),
      y: Math.min(r.height, Math.max(0, clientY - r.top))
    }
  }

  // Crop coords are read from the image's bounding rect, which a CSS rotate/flip
  // would distort — so cropping is only offered on the untransformed image.
  const canCrop = rotate === 0 && !flipH

  function onDown(e: React.PointerEvent): void {
    if (!canCrop) return
    const p = rel(e.clientX, e.clientY)
    draw.current = p
    setCrop({ x: p.x, y: p.y, w: 0, h: 0 })
    const move = (ev: PointerEvent): void => {
      if (!draw.current) return
      const c = rel(ev.clientX, ev.clientY)
      setCrop({
        x: Math.min(draw.current.x, c.x),
        y: Math.min(draw.current.y, c.y),
        w: Math.abs(c.x - draw.current.x),
        h: Math.abs(c.y - draw.current.y)
      })
    }
    const up = (): void => {
      draw.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function add(): void {
    const img = imgRef.current
    let sourceCrop: Crop | undefined
    if (img && crop && crop.w > 4 && crop.h > 4) {
      const rect = img.getBoundingClientRect()
      const sx = img.naturalWidth / rect.width
      const sy = img.naturalHeight / rect.height
      sourceCrop = { x: crop.x * sx, y: crop.y * sy, w: crop.w * sx, h: crop.h * sy }
    }
    onAddEdited({ ...item, suggestedName: name.trim() || item.baseName }, { crop: sourceCrop, rotate, flipH })
  }

  const edited = rotate !== 0 || flipH || !!(crop && crop.w > 4)
  const stateLabel = [crop && crop.w > 4 ? 'cropped' : '', rotate ? `${rotate}°` : '', flipH ? 'flipped' : '']
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="select-none">
      <div className="grid place-items-center rounded-xl border border-borderSoft bg-black p-4">
        <div className="relative inline-block">
          <img
            ref={imgRef}
            src={url}
            alt={item.originalName}
            draggable={false}
            onPointerDown={onDown}
            style={{ transform: `rotate(${rotate}deg) scaleX(${flipH ? -1 : 1})` }}
            className={`max-h-[42vh] object-contain transition-transform ${canCrop ? 'cursor-crosshair' : 'cursor-default'}`}
          />
          {canCrop && crop && crop.w > 1 && (
            <div
              className="pointer-events-none absolute border-2 border-mint"
              style={{
                left: crop.x,
                top: crop.y,
                width: crop.w,
                height: crop.h,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)'
              }}
            />
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <button onClick={() => { setCrop(null); setRotate((r) => (r + 270) % 360) }} className="btn !py-1.5">
          Rotate left
        </button>
        <button onClick={() => { setCrop(null); setRotate((r) => (r + 90) % 360) }} className="btn !py-1.5">
          Rotate right
        </button>
        <button onClick={() => { setCrop(null); setFlipH((f) => !f) }} className={`btn !py-1.5 ${flipH ? '!border-mint/60 !text-mint' : ''}`}>
          Flip
        </button>
        {crop && (
          <button onClick={() => setCrop(null)} className="btn !py-1.5">
            Clear crop
          </button>
        )}
        <span className="ml-auto text-faint">
          {edited ? `Output: ${stateLabel}` : canCrop ? 'Drag on the image to crop' : ''}
        </span>
      </div>

      <div className="mt-4">
        <div className="mb-1 text-xs font-medium text-muted">Name for this image</div>
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field font-mono text-sm"
            placeholder="type a name…"
          />
          <span className="text-xs text-faint">.{item.ext}</span>
          <button onClick={aiRename} disabled={renaming} className="btn whitespace-nowrap !py-2 text-xs">
            {renaming ? 'Naming…' : 'Suggest a name (1 credit)'}
          </button>
        </div>
        {renameNote && <div className="mt-1 text-[11px] text-peach">{renameNote}</div>}
      </div>

      <div className="mt-3">
        <button onClick={add} className="btn-primary">
          {edited ? 'Add edited image to tray' : 'Add image to tray'}
        </button>
      </div>
    </div>
  )
}
