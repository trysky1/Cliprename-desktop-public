import path from 'path'
import { MediaKind } from '../shared/types'

// One clip's worth of data needed to write a project file. Durations come from
// the ffmpeg probe (see media.ts `getMediaInfo`); images/audio get sensible
// fallbacks so the editor still lays them out.
export interface NleClip {
  path: string
  name: string // suggested/final name, no extension
  ext: string
  kind: MediaKind
  bin: string // bin / keyword-collection name (category or action group)
  description?: string
  tags?: string[]
  durationSec: number
  width?: number
  height?: number
}

// ---- helpers ----

function xml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Absolute path -> RFC-8089 file URL. Percent-encodes each path segment
// (encodeURI would leave '#' and '?' alone, truncating the URL in the editor)
// while keeping the slashes and a Windows drive segment like "C:" intact.
export function fileUrl(p: string): string {
  let abs = path.resolve(p).replace(/\\/g, '/')
  if (!abs.startsWith('/')) abs = '/' + abs // C:/… -> /C:/…
  return (
    'file://' +
    abs
      .split('/')
      .map((seg) => (/^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
      .join('/')
  )
}

// Whole frames at a 30 fps timebase (FCPXML wants rational time like "1800/30s").
function frames30(sec: number): number {
  return Math.max(1, Math.round((sec || 0) * 30))
}

function binName(raw: string): string {
  const n = (raw || '').trim()
  return n || 'Unsorted'
}

function groupByBin(clips: NleClip[]): Map<string, NleClip[]> {
  const map = new Map<string, NleClip[]>()
  for (const c of clips) {
    const key = binName(c.bin)
    const arr = map.get(key) ?? []
    arr.push(c)
    map.set(key, arr)
  }
  return map
}

// Default still duration for images (no intrinsic length).
const STILL_SEC = 5

// ---------- FCPXML 1.9 (Final Cut Pro + DaVinci Resolve) ----------
// Clips become `asset-clip`s inside one Event; each clip's bin is written as a
// `keyword`, which Final Cut turns into a Keyword Collection (its idea of a bin).
export function buildFcpxml(clips: NleClip[], eventName = 'ClipRename Export'): string {
  const resources: string[] = [
    '<format id="r1" name="FFVideoFormat1080p30" frameDuration="1/30s" width="1920" height="1080"/>'
  ]
  const assetClips: string[] = []

  clips.forEach((c, i) => {
    const id = `a${i + 1}`
    const sec = c.kind === 'image' ? STILL_SEC : c.durationSec
    const d = `${frames30(sec)}/30s`
    const hasVideo = c.kind === 'video' || c.kind === 'image' ? '1' : '0'
    const hasAudio = c.kind === 'audio' || c.kind === 'video' ? '1' : '0'
    resources.push(
      `    <asset id="${id}" name="${xml(c.name)}" start="0s" duration="${d}" ` +
        `hasVideo="${hasVideo}" hasAudio="${hasAudio}" format="r1">\n` +
        `      <media-rep kind="original-media" src="${xml(fileUrl(c.path))}"/>\n` +
        `    </asset>`
    )
    const noteBits = [c.description, c.tags && c.tags.length ? `Tags: ${c.tags.join(', ')}` : '']
      .filter(Boolean)
      .join(' — ')
    assetClips.push(
      `      <asset-clip ref="${id}" name="${xml(c.name)}" duration="${d}" format="r1">\n` +
        `        <keyword start="0s" duration="${d}" value="${xml(binName(c.bin))}"/>\n` +
        (noteBits ? `        <note>${xml(noteBits)}</note>\n` : '') +
        `      </asset-clip>`
    )
  })

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE fcpxml>\n` +
    `<fcpxml version="1.9">\n` +
    `  <resources>\n${resources.join('\n')}\n  </resources>\n` +
    `  <library>\n` +
    `    <event name="${xml(eventName)}">\n` +
    `${assetClips.join('\n')}\n` +
    `    </event>\n` +
    `  </library>\n` +
    `</fcpxml>\n`
  )
}

// ---------- Final Cut Pro 7 XML / <xmeml> (Adobe Premiere Pro) ----------
// Premiere imports this as nested bins. Each category becomes a child <bin>.
export function buildPremiereXml(clips: NleClip[], rootName = 'ClipRename Export'): string {
  const bins = groupByBin(clips)
  let clipId = 0
  const binNodes: string[] = []

  for (const [name, list] of bins) {
    const children = list
      .map((c) => {
        clipId++
        const sec = c.kind === 'image' ? STILL_SEC : c.durationSec
        const f = frames30(sec)
        const comment = [c.description, c.tags && c.tags.length ? c.tags.join(', ') : '']
          .filter(Boolean)
          .join(' — ')
        return (
          `          <clip id="clip-${clipId}">\n` +
          `            <name>${xml(c.name)}</name>\n` +
          `            <duration>${f}</duration>\n` +
          `            <rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate>\n` +
          `            <file id="file-${clipId}">\n` +
          `              <name>${xml(c.name + '.' + c.ext)}</name>\n` +
          `              <pathurl>${xml(fileUrl(c.path))}</pathurl>\n` +
          `              <rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate>\n` +
          `              <duration>${f}</duration>\n` +
          `            </file>\n` +
          (comment
            ? `            <comments><mastercomment1>${xml(comment)}</mastercomment1></comments>\n`
            : '') +
          `          </clip>`
        )
      })
      .join('\n')
    binNodes.push(
      `      <bin>\n` +
        `        <name>${xml(name)}</name>\n` +
        `        <children>\n${children}\n        </children>\n` +
        `      </bin>`
    )
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE xmeml>\n` +
    `<xmeml version="4">\n` +
    `  <bin>\n` +
    `    <name>${xml(rootName)}</name>\n` +
    `    <children>\n${binNodes.join('\n')}\n    </children>\n` +
    `  </bin>\n` +
    `</xmeml>\n`
  )
}
