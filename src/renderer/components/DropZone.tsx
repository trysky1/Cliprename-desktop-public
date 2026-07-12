import React, { useState } from 'react'
import { ScanResult } from '../../shared/types'
import { formatBytes } from '../lib/format'
import MediaThumb, { kindOfPath } from './MediaThumb'

interface Props {
  sources: string[]
  scan: ScanResult | null
  scanning: boolean
  lastFolder: string
  onAddFiles: () => void
  onAddFolder: () => void
  onDropPaths: (paths: string[]) => void
  onRemoveSource: (path: string) => void
  onReopenLast: () => void
}

function baseName(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}

export default function DropZone({
  sources,
  scan,
  scanning,
  lastFolder,
  onAddFiles,
  onAddFolder,
  onDropPaths,
  onRemoveSource,
  onReopenLast
}: Props): React.ReactElement {
  const [hover, setHover] = useState(false)

  function handleDrop(e: React.DragEvent): void {
    e.preventDefault()
    setHover(false)
    const paths: string[] = []
    for (const f of Array.from(e.dataTransfer.files) as (File & { path?: string })[]) {
      let p: string | undefined = f.path
      if (!p) {
        try {
          p = window.api.pathForFile(f)
        } catch {
          p = undefined
        }
      }
      if (p) paths.push(p)
    }
    if (paths.length) onDropPaths(paths)
  }

  // Empty state — big dropzone
  if (sources.length === 0) {
    return (
      <div
        onClick={onAddFiles}
        onDragOver={(e) => {
          e.preventDefault()
          setHover(true)
        }}
        onDragLeave={() => setHover(false)}
        onDrop={handleDrop}
        className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-all ${
          hover ? 'border-mint bg-mint/5 scale-[1.01]' : 'border-border bg-surface2/40 hover:border-faint'
        }`}
      >
        <div className="mx-auto mb-4 w-fit rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-faint">
          {scanning ? 'Reading' : 'Drop here'}
        </div>
        <div className="text-base font-semibold">
          {scanning ? 'Looking through your files…' : 'Drop folders or files here'}
        </div>
        <div className="mx-auto mt-1 max-w-sm text-[13px] text-muted">
          Or click to choose files. You can add several folders from different drives.
        </div>
        {!scanning && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onAddFolder()
              }}
              className="btn !py-2 text-xs"
            >
              Add a folder
            </button>
            {lastFolder && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onReopenLast()
                }}
                className="btn !py-2 text-xs"
                title={lastFolder}
              >
                Reopen last folder
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  // With sources — list + add controls + summary
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setHover(true)
      }}
      onDragLeave={() => setHover(false)}
      onDrop={handleDrop}
      className={`rounded-2xl border p-3 transition-colors ${
        hover ? 'border-mint bg-mint/5' : 'border-border bg-surface2/40'
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium text-muted">
          {sources.length} source{sources.length > 1 ? 's' : ''}
          {scan && <span className="text-faint"> · {scan.items.length} files · {formatBytes(scan.totalBytes)}</span>}
          {scanning && <span className="text-mint"> · scanning…</span>}
        </div>
        <div className="flex gap-2">
          <button onClick={onAddFolder} className="btn !py-1.5 !px-3 text-xs">
            Add folder
          </button>
          <button onClick={onAddFiles} className="btn !py-1.5 !px-3 text-xs">
            Add files
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        {sources.map((s) => (
          <div
            key={s}
            className="group flex items-center gap-2.5 rounded-lg border border-borderSoft bg-surface px-3 py-2"
          >
            {s.match(/\.[a-z0-9]{1,5}$/i) && kindOfPath(s) !== 'other' ? (
              <MediaThumb path={s} className="h-11 w-14 rounded-md" />
            ) : (
              <span className="grid h-11 w-14 shrink-0 place-items-center rounded-md bg-surface2 text-[10px] uppercase tracking-wide text-faint">
                {s.match(/\.[a-z0-9]{1,5}$/i) ? 'file' : 'folder'}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-text">{baseName(s)}</div>
              <div className="truncate text-[11px] text-faint">{s}</div>
            </div>
            <button
              onClick={() => onRemoveSource(s)}
              title="Remove this source"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-faint opacity-60 transition-all hover:bg-peach/10 hover:text-peach group-hover:opacity-100"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {scan && !scanning && scan.items.length === 0 && (
        <div className="mt-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-warning">
          No readable media found here. If you added a single file, try “Add folder” instead —
          empty or system files (like macOS “._” stubs) are skipped.
        </div>
      )}

      <div className="mt-2 text-center text-[11px] text-faint">
        Drop more folders/files here to add them
      </div>
    </div>
  )
}
