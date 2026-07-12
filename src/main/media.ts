import { app } from 'electron'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import { getSettings } from './store'
import type { AutoClipAnalysis } from '../shared/types'

// Resolve the bundled ffmpeg binary, accounting for asar packaging.
function resolveFfmpegPath(): string | null {
  const raw = ffmpegStatic as unknown as string | null
  if (!raw) return null
  // In a packaged build the binary is unpacked next to app.asar.
  return raw.replace('app.asar', 'app.asar.unpacked')
}

let ffmpegReady = false
function ensureFfmpeg(): boolean {
  if (ffmpegReady) return true
  const p = resolveFfmpegPath()
  if (!p) return false
  ffmpeg.setFfmpegPath(p)
  ffmpegReady = true
  return true
}

export function isFfmpegAvailable(): boolean {
  return ensureFfmpeg()
}

async function tmpFile(ext: string): Promise<string> {
  const dir = path.join(app.getPath('temp'), 'cliprename')
  await fs.mkdir(dir, { recursive: true })
  const rand = Math.abs(hashStr(dir + ext + process.hrtime.bigint().toString())).toString(36)
  return path.join(dir, `cr-${rand}.${ext}`)
}

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}

export interface MediaPart {
  mimeType: string
  data: string // base64
}

async function fileToBase64(p: string): Promise<string> {
  const buf = await fs.readFile(p)
  return buf.toString('base64')
}

// Grab one representative frame from a video, downscaled, as JPEG base64.
export function extractKeyframe(videoPath: string): Promise<MediaPart | null> {
  return new Promise(async (resolve) => {
    if (!ensureFfmpeg()) return resolve(null)
    let out: string
    try {
      out = await tmpFile('jpg')
    } catch {
      return resolve(null)
    }
    ffmpeg(videoPath)
      .outputOptions(['-vf', "thumbnail,scale=640:-1", '-frames:v', '1', '-q:v', '4'])
      .on('error', () => resolve(null))
      .on('end', async () => {
        try {
          const data = await fileToBase64(out)
          await fs.unlink(out).catch(() => {})
          resolve({ mimeType: 'image/jpeg', data })
        } catch {
          resolve(null)
        }
      })
      .save(out)
  })
}

// Several frames sampled evenly across a video, as JPEG base64 parts. Unlike a
// single keyframe, this lets the AI read motion over time to identify the
// ACTION being performed (a kick vs a bicycle kick, what's being cooked, etc.).
export async function extractFrames(videoPath: string, count = 6): Promise<MediaPart[]> {
  if (!ensureFfmpeg()) return []
  const n = Math.max(2, Math.min(count, 10))
  const info = await getMediaInfo(videoPath)
  const dur = info.durationSec
  // Duration unknown — fall back to a single representative frame.
  if (!(dur > 0)) {
    const one = await extractKeyframe(videoPath)
    return one ? [one] : []
  }
  const frames: MediaPart[] = []
  for (let i = 0; i < n; i++) {
    const ts = dur * ((i + 0.5) / n)
    const part = await new Promise<MediaPart | null>(async (resolve) => {
      let out: string
      try {
        out = await tmpFile('jpg')
      } catch {
        return resolve(null)
      }
      ffmpeg(videoPath)
        .seekInput(Math.max(0, ts))
        .outputOptions(['-vf', 'scale=512:-1', '-frames:v', '1', '-q:v', '5'])
        .on('error', () => resolve(null))
        .on('end', async () => {
          try {
            const data = await fileToBase64(out)
            await fs.unlink(out).catch(() => {})
            resolve({ mimeType: 'image/jpeg', data })
          } catch {
            resolve(null)
          }
        })
        .save(out)
    })
    if (part) frames.push(part)
  }
  return frames
}

// Downscale an image to JPEG base64 to keep token cost low.
export function prepImage(imagePath: string): Promise<MediaPart | null> {
  return new Promise(async (resolve) => {
    if (!ensureFfmpeg()) {
      // Fallback: send original bytes if small enough (< 4MB).
      try {
        const stat = await fs.stat(imagePath)
        if (stat.size < 4 * 1024 * 1024) {
          const ext = path.extname(imagePath).slice(1).toLowerCase()
          const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
          return resolve({ mimeType: mime, data: await fileToBase64(imagePath) })
        }
      } catch {
        /* ignore */
      }
      return resolve(null)
    }
    let out: string
    try {
      out = await tmpFile('jpg')
    } catch {
      return resolve(null)
    }
    ffmpeg(imagePath)
      .outputOptions(['-vf', 'scale=768:-1', '-frames:v', '1', '-q:v', '4'])
      .on('error', () => resolve(null))
      .on('end', async () => {
        try {
          const data = await fileToBase64(out)
          await fs.unlink(out).catch(() => {})
          resolve({ mimeType: 'image/jpeg', data })
        } catch {
          resolve(null)
        }
      })
      .save(out)
  })
}

// Extract a short mono low-bitrate clip from an audio file for analysis.
export function extractAudioClip(audioPath: string): Promise<MediaPart | null> {
  return new Promise(async (resolve) => {
    if (!ensureFfmpeg()) return resolve(null)
    let out: string
    try {
      out = await tmpFile('mp3')
    } catch {
      return resolve(null)
    }
    ffmpeg(audioPath)
      .outputOptions(['-t', '12', '-ac', '1', '-ar', '16000', '-b:a', '32k'])
      .on('error', () => resolve(null))
      .on('end', async () => {
        try {
          const data = await fileToBase64(out)
          await fs.unlink(out).catch(() => {})
          resolve({ mimeType: 'audio/mp3', data })
        } catch {
          resolve(null)
        }
      })
      .save(out)
  })
}

// A single frame at a specific timestamp (for naming based on the selected part).
export function frameAt(videoPath: string, ts: number): Promise<MediaPart | null> {
  return new Promise(async (resolve) => {
    if (!ensureFfmpeg()) return resolve(null)
    let out: string
    try {
      out = await tmpFile('jpg')
    } catch {
      return resolve(null)
    }
    ffmpeg(videoPath)
      .seekInput(Math.max(0, ts))
      .outputOptions(['-vf', 'scale=640:-1', '-frames:v', '1', '-q:v', '4'])
      .on('error', () => resolve(null))
      .on('end', async () => {
        try {
          const data = await fileToBase64(out)
          await fs.unlink(out).catch(() => {})
          resolve({ mimeType: 'image/jpeg', data })
        } catch {
          resolve(null)
        }
      })
      .save(out)
  })
}

// A short audio slice starting at a timestamp (for naming the selected part).
export function audioRange(audioPath: string, startSec: number, durSec: number): Promise<MediaPart | null> {
  return new Promise(async (resolve) => {
    if (!ensureFfmpeg()) return resolve(null)
    let out: string
    try {
      out = await tmpFile('mp3')
    } catch {
      return resolve(null)
    }
    ffmpeg(audioPath)
      .seekInput(Math.max(0, startSec))
      .duration(Math.max(1, Math.min(durSec || 12, 30)))
      .outputOptions(['-ac', '1', '-ar', '16000', '-b:a', '32k'])
      .on('error', () => resolve(null))
      .on('end', async () => {
        try {
          const data = await fileToBase64(out)
          await fs.unlink(out).catch(() => {})
          resolve({ mimeType: 'audio/mp3', data })
        } catch {
          resolve(null)
        }
      })
      .save(out)
  })
}

// Render the audio track as a waveform image (mint on transparent) so the user
// can see peaks under the video/audio. Resolves null if there's no audio.
export function waveform(filePath: string): Promise<string | null> {
  return new Promise(async (resolve) => {
    if (!ensureFfmpeg()) return resolve(null)
    let out: string
    try {
      out = await tmpFile('png')
    } catch {
      return resolve(null)
    }
    ffmpeg(filePath)
      .outputOptions([
        '-filter_complex',
        'showwavespic=s=1000x90:colors=0x6EE87A',
        '-frames:v',
        '1'
      ])
      .on('error', () => resolve(null))
      .on('end', async () => {
        try {
          const data = await fileToBase64(out)
          await fs.unlink(out).catch(() => {})
          resolve(`data:image/png;base64,${data}`)
        } catch {
          resolve(null)
        }
      })
      .save(out)
  })
}

// Detect beats/onsets in a clip's audio (energy-envelope analysis) + estimate BPM.
export async function detectBeats(filePath: string): Promise<{ beats: number[]; bpm: number }> {
  if (!ensureFfmpeg()) return { beats: [], bpm: 0 }
  const sr = 11025
  let wavPath: string
  try {
    wavPath = await tmpFile('wav')
  } catch {
    return { beats: [], bpm: 0 }
  }
  const ok = await new Promise<boolean>((resolve) => {
    ffmpeg(filePath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(sr)
      .toFormat('wav')
      .on('error', () => resolve(false))
      .on('end', () => resolve(true))
      .save(wavPath)
  })
  let buf: Buffer | null = null
  try {
    if (ok) buf = await fs.readFile(wavPath)
  } catch {
    buf = null
  }
  await fs.unlink(wavPath).catch(() => {})
  if (!buf) return { beats: [], bpm: 0 }

  // locate the PCM 'data' chunk
  let off = 12
  let dataOffset = -1
  let dataLen = 0
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'data') {
      dataOffset = off + 8
      dataLen = size
      break
    }
    off += 8 + size + (size % 2)
  }
  if (dataOffset < 0) return { beats: [], bpm: 0 }
  const samples = Math.min(dataLen, buf.length - dataOffset) >> 1

  // short-time RMS energy
  const frame = 1024
  const hop = 512
  const energies: number[] = []
  for (let i = 0; i + frame <= samples; i += hop) {
    let sum = 0
    for (let j = 0; j < frame; j++) {
      const s = buf.readInt16LE(dataOffset + (i + j) * 2) / 32768
      sum += s * s
    }
    energies.push(Math.sqrt(sum / frame))
  }
  if (energies.length < 4) return { beats: [], bpm: 0 }

  const fps = sr / hop
  const win = Math.max(4, Math.round(fps * 0.4))
  const minGap = Math.max(1, Math.round(fps * 0.14))
  const mean = energies.reduce((a, b) => a + b, 0) / energies.length

  const beats: number[] = []
  let lastBeat = -Infinity
  for (let i = 1; i < energies.length - 1; i++) {
    const a = Math.max(0, i - win)
    const b = Math.min(energies.length, i + win)
    let local = 0
    for (let k = a; k < b; k++) local += energies[k]
    local /= b - a
    const e = energies[i]
    if (
      e > local * 1.35 &&
      e >= energies[i - 1] &&
      e >= energies[i + 1] &&
      e > mean * 0.6 &&
      i - lastBeat >= minGap
    ) {
      beats.push((i * hop) / sr)
      lastBeat = i
    }
  }

  let bpm = 0
  if (beats.length > 2) {
    const iois: number[] = []
    for (let i = 1; i < beats.length; i++) iois.push(beats[i] - beats[i - 1])
    iois.sort((a, b) => a - b)
    const med = iois[Math.floor(iois.length / 2)]
    if (med > 0.01) {
      bpm = 60 / med
      while (bpm < 70) bpm *= 2
      while (bpm > 185) bpm /= 2
      bpm = Math.round(bpm)
    }
  }
  return { beats, bpm }
}

function timecode(sec: number, fps = 30): string {
  const f = Math.floor((sec % 1) * fps)
  const s = Math.floor(sec) % 60
  const m = Math.floor(sec / 60) % 60
  const h = Math.floor(sec / 3600)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`
}

// Write beat-marker sidecar files into the tray folder for the editor to import.
export async function saveBeatMarkers(
  baseName: string,
  beats: number[],
  bpm: number
): Promise<{ folder: string }> {
  const dir = stagingDir()
  await fs.mkdir(dir, { recursive: true })
  const name = sanitizeName(baseName)
  // Audacity label track (start \t end \t label)
  const txt = beats.map((t, i) => `${t.toFixed(3)}\t${t.toFixed(3)}\tBeat ${i + 1}`).join('\n')
  await fs.writeFile(path.join(dir, `${name}.beats.txt`), txt)
  // CSV of timecodes (BPM in the header)
  const csv = [
    `# ${name} — ${beats.length} beats${bpm ? ` — ~${bpm} BPM` : ''}`,
    'Index,Seconds,Timecode',
    ...beats.map((t, i) => `${i + 1},${t.toFixed(3)},${timecode(t)}`)
  ].join('\n')
  await fs.writeFile(path.join(dir, `${name}.beats.csv`), csv)
  // After Effects script: select a layer, File > Scripts > Run Script File →
  // every beat becomes a layer marker. One click, no manual typing.
  const jsx = [
    `// ${name} — adds ${beats.length} beat markers${bpm ? ` (~${bpm} BPM)` : ''} to the selected layer(s).`,
    '// In After Effects: select your music/video layer, then File > Scripts > Run Script File... and pick this file.',
    '(function () {',
    `  var beats = [${beats.map((t) => t.toFixed(3)).join(', ')}];`,
    '  var comp = app.project.activeItem;',
    "  if (!comp || !(comp instanceof CompItem)) { alert('Open a composition first, then select the layer that should get the beat markers.'); return; }",
    '  var layers = comp.selectedLayers;',
    "  if (layers.length === 0) { alert('Select the layer that should get the ' + beats.length + ' beat markers, then run this script again.'); return; }",
    "  app.beginUndoGroup('Add beat markers');",
    '  for (var L = 0; L < layers.length; L++) {',
    '    for (var i = 0; i < beats.length; i++) {',
    "      layers[L].property('Marker').setValueAtTime(beats[i], new MarkerValue('Beat ' + (i + 1)));",
    '    }',
    '  }',
    '  app.endUndoGroup();',
    "  alert('Added ' + beats.length + ' beat markers to ' + layers.length + ' layer(s).');",
    '})();'
  ].join('\n')
  await fs.writeFile(path.join(dir, `${name}.beats.jsx`), jsx)
  return { folder: dir }
}

// Small data-URL thumbnail of the real content, for the preview UI.
export function makeThumbnail(filePath: string, kind: string): Promise<string | null> {
  return new Promise(async (resolve) => {
    if (kind !== 'video' && kind !== 'image') return resolve(null)
    if (!ensureFfmpeg()) {
      // image fallback: send original if small enough
      if (kind === 'image') {
        try {
          const stat = await fs.stat(filePath)
          if (stat.size < 3 * 1024 * 1024) {
            const ext = path.extname(filePath).slice(1).toLowerCase()
            const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
            return resolve(`data:${mime};base64,${await fileToBase64(filePath)}`)
          }
        } catch {
          /* ignore */
        }
      }
      return resolve(null)
    }
    let out: string
    try {
      out = await tmpFile('jpg')
    } catch {
      return resolve(null)
    }
    const vf = kind === 'video' ? 'thumbnail,scale=360:-1' : 'scale=360:-1'
    ffmpeg(filePath)
      .outputOptions(['-vf', vf, '-frames:v', '1', '-q:v', '5'])
      .on('error', () => resolve(null))
      .on('end', async () => {
        try {
          const data = await fileToBase64(out)
          await fs.unlink(out).catch(() => {})
          resolve(`data:image/jpeg;base64,${data}`)
        } catch {
          resolve(null)
        }
      })
      .save(out)
  })
}

// ---------- Clipping / staging (the drag-out tray) ----------

// One folder per app session, so "drag all" hands a single tidy folder to the editor
// (imports as a bin in Premiere/After Effects) without mixing in old runs.
const SESSION_LABEL = (() => {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `ClipRename ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`
})()

// Every staging dir handed out this session — removeStaged checks against all
// of them so changing the tray folder can't orphan already-staged clips.
const sessionStagingDirs = new Set<string>()

export function stagingDir(): string {
  const chosen = getSettings().trayDir?.trim()
  const base = chosen || path.join(app.getPath('userData'), 'ClipRename Tray')
  const dir = path.join(base, SESSION_LABEL)
  sessionStagingDirs.add(dir)
  return dir
}

function sanitizeName(s: string): string {
  return s.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim() || 'clip'
}

async function uniqueIn(dir: string, name: string, ext: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true })
  let candidate = path.join(dir, `${name}.${ext}`)
  let n = 1
  while (true) {
    try {
      await fs.access(candidate)
      candidate = path.join(dir, `${name}-${n}.${ext}`)
      n++
    } catch {
      return candidate
    }
  }
}

// Read a media file's duration + pixel size by parsing ffmpeg's stderr (no ffprobe needed).
export function getMediaInfo(
  filePath: string
): Promise<{ durationSec: number; width: number; height: number }> {
  return new Promise((resolve) => {
    const bin = resolveFfmpegPath()
    if (!bin) return resolve({ durationSec: 0, width: 0, height: 0 })
    execFile(bin, ['-hide_banner', '-i', filePath], (_err, _stdout, stderr) => {
      const s = stderr || ''
      const d = s.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
      const durationSec = d ? +d[1] * 3600 + +d[2] * 60 + parseFloat(d[3]) : 0
      // First WxH on a Video/Image stream line.
      const dim = s.match(/,\s(\d{2,5})x(\d{2,5})/)
      resolve({
        durationSec,
        width: dim ? +dim[1] : 0,
        height: dim ? +dim[2] : 0
      })
    })
  })
}

// Read a human-meaningful title from the file's embedded metadata (container
// tags like title / artist) with NO AI call. Many exported or downloaded clips
// carry a real title here even when the on-disk filename is a camera/timestamp
// code — using it is the cheapest, most accurate way to name such files.
export function readEmbeddedTitle(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const bin = resolveFfmpegPath()
    if (!bin) return resolve(null)
    execFile(bin, ['-hide_banner', '-i', filePath], (_err, _stdout, stderr) => {
      const s = stderr || ''
      const tag = (name: string): string => {
        // ffmpeg prints tags as "    title           : Some Title"
        const m = s.match(new RegExp(`^\\s*${name}\\s*:\\s*(.+?)\\s*$`, 'im'))
        return m ? m[1].trim() : ''
      }
      const title = tag('title')
      const artist = tag('artist') || tag('album_artist')
      let out = ''
      if (title && artist && !title.toLowerCase().includes(artist.toLowerCase()))
        out = `${artist} - ${title}`
      else out = title || artist
      resolve(out && out.length >= 2 ? out : null)
    })
  })
}

// Evenly spaced preview frames so the user can see content along the timeline.
export async function filmstrip(filePath: string, durationSec: number, count = 6): Promise<string[]> {
  if (!ensureFfmpeg() || durationSec <= 0) return []
  const shots: string[] = []
  for (let i = 0; i < count; i++) {
    const ts = durationSec * ((i + 0.5) / count)
    const url = await new Promise<string | null>(async (resolve) => {
      let out: string
      try {
        out = await tmpFile('jpg')
      } catch {
        return resolve(null)
      }
      ffmpeg(filePath)
        .seekInput(ts)
        .outputOptions(['-vf', 'scale=220:-1', '-frames:v', '1', '-q:v', '6'])
        .on('error', () => resolve(null))
        .on('end', async () => {
          try {
            const d = await fileToBase64(out)
            await fs.unlink(out).catch(() => {})
            resolve(`data:image/jpeg;base64,${d}`)
          } catch {
            resolve(null)
          }
        })
        .save(out)
    })
    if (url) shots.push(url)
  }
  return shots
}

export interface StageReq {
  srcPath: string
  baseName: string
  ext: string
  kind: string
  startSec?: number
  endSec?: number
}

// Produce a renamed (and optionally trimmed) real file in the staging folder,
// ready to be dragged into an editor.
export async function stageClip(req: StageReq): Promise<{ stagedPath: string; fallback?: boolean }> {
  const dir = stagingDir()
  const name = sanitizeName(req.baseName)
  const out = await uniqueIn(dir, name, req.ext)
  const hasRange =
    typeof req.startSec === 'number' &&
    typeof req.endSec === 'number' &&
    (req.endSec as number) > (req.startSec as number)

  if (req.kind === 'image' || !hasRange || !ensureFfmpeg()) {
    await fs.copyFile(req.srcPath, out)
    // A requested trim that couldn't run (no ffmpeg) is a fallback, not success.
    return { stagedPath: out, fallback: hasRange && req.kind !== 'image' }
  }

  const duration = (req.endSec as number) - (req.startSec as number)
  // Video trims are re-encoded so the cut lands on the exact frame the user
  // chose — stream copy snaps to keyframes and can drag seconds of unwanted
  // footage back in. Audio packets are tiny, so copy stays accurate there.
  const trimOpts =
    req.kind === 'video'
      ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-avoid_negative_ts', 'make_zero']
      : ['-c', 'copy', '-avoid_negative_ts', 'make_zero']
  let fallback = false
  await new Promise<void>((resolve, reject) => {
    ffmpeg(req.srcPath)
      .seekInput(req.startSec as number)
      .duration(duration)
      .outputOptions(trimOpts)
      .on('error', (e) => reject(e))
      .on('end', () => resolve())
      .save(out)
  }).catch(async () => {
    // If the trim fails (odd container/codec), fall back to copying the whole
    // file — and SAY so, or the UI would label an untrimmed file "Trimmed".
    fallback = true
    await fs.copyFile(req.srcPath, out).catch(() => {})
  })
  return { stagedPath: out, fallback }
}

export interface EditImageReq {
  srcPath: string
  baseName: string
  ext: string
  crop?: { x: number; y: number; w: number; h: number } // in source pixels
  rotate?: number // 0 | 90 | 180 | 270
  flipH?: boolean
}

// Apply crop / rotate / flip to an image and stage the result.
export async function editImage(req: EditImageReq): Promise<{ stagedPath: string; fallback?: boolean }> {
  const dir = stagingDir()
  const name = sanitizeName(req.baseName)
  const out = await uniqueIn(dir, name, req.ext || 'png')

  if (!ensureFfmpeg()) {
    await fs.copyFile(req.srcPath, out).catch(() => {})
    return { stagedPath: out, fallback: true }
  }

  let fallback = false
  const filters: string[] = []
  if (req.crop && req.crop.w > 1 && req.crop.h > 1) {
    const c = req.crop
    filters.push(`crop=${Math.round(c.w)}:${Math.round(c.h)}:${Math.round(c.x)}:${Math.round(c.y)}`)
  }
  const rot = (((req.rotate || 0) % 360) + 360) % 360
  if (rot === 90) filters.push('transpose=1')
  else if (rot === 180) filters.push('transpose=2,transpose=2')
  else if (rot === 270) filters.push('transpose=2')
  if (req.flipH) filters.push('hflip')

  await new Promise<void>((resolve, reject) => {
    let cmd = ffmpeg(req.srcPath)
    if (filters.length) cmd = cmd.outputOptions(['-vf', filters.join(',')])
    cmd
      .outputOptions(['-frames:v', '1'])
      .on('error', (e) => reject(e))
      .on('end', () => resolve())
      .save(out)
  }).catch(async () => {
    fallback = true
    await fs.copyFile(req.srcPath, out).catch(() => {})
  })
  return { stagedPath: out, fallback }
}

export async function removeStaged(p: string): Promise<void> {
  // Accept paths under ANY staging dir used this session — after the user
  // changes the tray folder, clips staged under the old one must still be
  // removable (otherwise Remove/Clear silently leave files on disk).
  const target = path.resolve(p)
  for (const d of sessionStagingDirs) {
    if (target.startsWith(path.resolve(d) + path.sep)) {
      await fs.unlink(p).catch(() => {})
      return
    }
  }
}

// ---------- Scene-out split ----------

interface SceneScore {
  time: number
  score: number
}

// One pass over the video collecting EVERY frame-change score above a tiny
// floor (not just the ones over a fixed threshold). Knowing the whole score
// distribution lets us tell real cuts (rare, huge spikes) apart from ordinary
// in-shot motion (constant, small scores) — a fixed threshold can't.
async function scanSceneScores(filePath: string): Promise<SceneScore[]> {
  const bin = resolveFfmpegPath()
  if (!bin) return []
  const stderr = await new Promise<string>((resolve) => {
    execFile(
      bin,
      [
        '-hide_banner',
        '-i',
        filePath,
        '-vf',
        "scale=320:-2,select='gt(scene,0.03)',metadata=print",
        '-an',
        '-f',
        'null',
        '-'
      ],
      { maxBuffer: 1024 * 1024 * 128 },
      (_err, _stdout, se) => resolve(se || '')
    )
  })
  // metadata=print logs pairs of lines:
  //   ... frame:12 pts:6006 pts_time:6.006
  //   ... lavfi.scene_score=0.404
  const scores: SceneScore[] = []
  let pendingTime = -1
  for (const line of stderr.split('\n')) {
    const t = line.match(/pts_time:([0-9]+(?:\.[0-9]+)?)/)
    if (t) {
      pendingTime = parseFloat(t[1])
      continue
    }
    const s = line.match(/lavfi\.scene_score=([0-9]+(?:\.[0-9]+)?)/)
    if (s && pendingTime >= 0) {
      scores.push({ time: pendingTime, score: parseFloat(s[1]) })
      pendingTime = -1
    }
  }
  return scores
}

// A tiny grayscale frame (48x27 raw bytes) at a timestamp, for comparing the
// picture on either side of a candidate cut.
function grabGrayFrame(filePath: string, ts: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const bin = resolveFfmpegPath()
    if (!bin) return resolve(null)
    execFile(
      bin,
      [
        '-hide_banner',
        '-ss',
        String(Math.max(0, ts)),
        '-i',
        filePath,
        '-frames:v',
        '1',
        '-vf',
        'scale=48:27',
        '-pix_fmt',
        'gray',
        '-f',
        'rawvideo',
        '-'
      ],
      { encoding: 'buffer', maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        const buf = stdout as unknown as Buffer
        resolve(!err && buf && buf.length >= 48 * 27 ? buf.subarray(0, 48 * 27) : null)
      }
    )
  })
}

function frameDiff(a: Buffer, b: Buffer): number {
  let sum = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i])
  return sum / (n * 255)
}

// Double-check a candidate cut by looking at the actual pictures around it:
// a real cut means the frame shortly AFTER the boundary looks nothing like the
// frames shortly BEFORE it — while the two before-frames still look alike.
// Camera motion / flashes fail this test, so false cuts get rejected.
async function verifyCut(filePath: string, t: number): Promise<boolean> {
  if (t < 0.45) return true // too close to the start to sample both sides
  const [before, beforeNear, after] = await Promise.all([
    grabGrayFrame(filePath, t - 0.4),
    grabGrayFrame(filePath, t - 0.12),
    grabGrayFrame(filePath, t + 0.25)
  ])
  if (!before || !beforeNear || !after) return true // can't verify — keep it
  const withinShot = frameDiff(before, beforeNear)
  // Chaotic content (whip pans, strobes, dancing crowds) moves so much between
  // nearby frames that this comparison says nothing — trust the score spike.
  if (withinShot > 0.08) return true
  const acrossCut = frameDiff(before, after)
  return acrossCut > Math.max(0.045, withinShot * 1.8)
}

// Find hard cuts in a video. `threshold` is 0..1 — higher means only stronger
// cuts count (fewer, bigger scenes). Detection is adaptive: the threshold
// floats up on shaky/high-motion footage so ordinary movement is never called
// a cut, and every candidate is verified against the surrounding frames.
export async function detectScenes(filePath: string, threshold = 0.4): Promise<number[]> {
  const scores = await scanSceneScores(filePath)
  if (scores.length === 0) return []

  // The user's sensitivity choice sets a floor; the clip's own motion level
  // raises it. Median of the sub-floor scores ≈ this clip's normal motion.
  const floor = 0.05 + threshold * 0.5
  const motion = scores.filter((s) => s.score < floor).map((s) => s.score).sort((a, b) => a - b)
  const motionMedian = motion.length ? motion[Math.floor(motion.length / 2)] : 0
  const effective = Math.min(0.7, Math.max(floor, motionMedian * 2.5))

  const MIN_GAP = 0.8
  const candidates: number[] = []
  let lastAt = -Infinity
  for (const s of scores.sort((a, b) => a.time - b.time)) {
    if (s.score < effective) continue
    if (s.time - lastAt < MIN_GAP) continue
    candidates.push(s.time)
    lastAt = s.time
  }

  const cuts: number[] = []
  for (const t of candidates) {
    if (await verifyCut(filePath, t)) cuts.push(t)
  }
  return cuts
}

// Split a video into one file per detected scene (stream-copy = fast & lossless).
// Clips land in a "<name> scenes" folder inside the tray, ready to drag out.
export async function splitScenes(
  filePath: string,
  baseName: string,
  opts: { threshold?: number; minSceneSec?: number } = {}
): Promise<{ outputDir: string; clips: { path: string; startSec: number; endSec: number }[] }> {
  if (!ensureFfmpeg()) return { outputDir: '', clips: [] }
  const info = await getMediaInfo(filePath)
  const total = info.durationSec || 0
  if (total <= 0) return { outputDir: '', clips: [] }
  const minScene = Math.max(0.3, opts.minSceneSec ?? 1)

  const cuts = await detectScenes(filePath, opts.threshold ?? 0.4)
  // No detectable cuts: return empty so the UI can say "no scene cuts found"
  // instead of duplicating the whole video as a single "scene-01" clip.
  if (cuts.length === 0) return { outputDir: '', clips: [] }
  // Turn cut points into [start,end] segments, dropping any too-short sliver.
  const boundaries = [0]
  for (const t of cuts) {
    if (t > minScene && t < total && t - boundaries[boundaries.length - 1] >= minScene) {
      boundaries.push(t)
    }
  }
  if (total - boundaries[boundaries.length - 1] >= minScene) boundaries.push(total)
  else boundaries[boundaries.length - 1] = total

  const segments: { startSec: number; endSec: number }[] = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    segments.push({ startSec: boundaries[i], endSec: boundaries[i + 1] })
  }
  if (segments.length === 0) segments.push({ startSec: 0, endSec: total })

  const ext = path.extname(filePath).slice(1).toLowerCase() || 'mp4'
  const name = sanitizeName(baseName)
  const outputDir = path.join(stagingDir(), `${name} scenes`)
  await fs.mkdir(outputDir, { recursive: true })

  const clips: { path: string; startSec: number; endSec: number }[] = []
  let idx = 0
  for (const seg of segments) {
    idx++
    const out = path.join(outputDir, `${name}-scene-${String(idx).padStart(2, '0')}.${ext}`)
    const ok = await new Promise<boolean>((resolve) => {
      ffmpeg(filePath)
        .seekInput(seg.startSec)
        .duration(Math.max(0.1, seg.endSec - seg.startSec))
        .outputOptions(['-c', 'copy', '-avoid_negative_ts', 'make_zero'])
        .on('error', () => resolve(false))
        .on('end', () => resolve(true))
        .save(out)
    })
    if (ok) clips.push({ path: out, startSec: seg.startSec, endSec: seg.endSec })
  }
  return { outputDir, clips }
}

// ---------- Auto clipper (cut the useless parts) ----------

// How hard to cut. 'gentle' only removes long dead air; 'aggressive' produces
// tight jump-cut material.
export type AutoClipStrength = 'gentle' | 'balanced' | 'aggressive'
export type AutoClipMode = 'silence' | 'still'

// dropDb: how far below the clip's own LOUDEST moment counts as "dead air".
// Real recordings always carry background hiss, so an absolute dB floor finds
// nothing — the threshold has to be relative to each clip's actual levels.
// freezeNoiseDb: how much sensor noise/grain still counts as "frozen picture".
const AUTO_CLIP_TUNING: Record<
  AutoClipStrength,
  { dropDb: number; minDeadSec: number; freezeSec: number; freezeNoiseDb: number }
> = {
  gentle: { dropDb: 30, minDeadSec: 2.0, freezeSec: 2.5, freezeNoiseDb: -55 },
  balanced: { dropDb: 24, minDeadSec: 1.0, freezeSec: 1.5, freezeNoiseDb: -45 },
  aggressive: { dropDb: 18, minDeadSec: 0.45, freezeSec: 0.8, freezeNoiseDb: -38 }
}

// Measure the clip's real audio levels (ffmpeg volumedetect). hasAudio=false
// means there is no audio stream at all.
async function measureAudio(
  filePath: string
): Promise<{ hasAudio: boolean; meanDb: number; maxDb: number }> {
  const bin = resolveFfmpegPath()
  if (!bin) return { hasAudio: false, meanDb: 0, maxDb: 0 }
  const stderr = await new Promise<string>((resolve) => {
    execFile(
      bin,
      ['-hide_banner', '-i', filePath, '-af', 'volumedetect', '-vn', '-f', 'null', '-'],
      { maxBuffer: 1024 * 1024 * 32 },
      (_err, _stdout, se) => resolve(se || '')
    )
  })
  const mean = stderr.match(/mean_volume:\s*(-?[0-9.]+)\s*dB/)
  const max = stderr.match(/max_volume:\s*(-?[0-9.]+)\s*dB/)
  if (!mean || !max) return { hasAudio: false, meanDb: 0, maxDb: 0 }
  return { hasAudio: true, meanDb: parseFloat(mean[1]), maxDb: parseFloat(max[1]) }
}

export type { AutoClipAnalysis }

// Find "dead" intervals via ffmpeg's own detectors: silencedetect (no sound)
// or freezedetect (frozen/static picture). Returns [start,end] pairs plus the
// analysis facts, so the UI can explain a "nothing found" honestly.
async function detectDeadRanges(
  filePath: string,
  mode: AutoClipMode,
  strength: AutoClipStrength,
  totalSec: number
): Promise<{ ranges: [number, number][]; analysis: AutoClipAnalysis }> {
  const t = AUTO_CLIP_TUNING[strength]
  const analysis: AutoClipAnalysis = {
    mode,
    hasAudio: false,
    maxDb: 0,
    thresholdDb: 0,
    deadCount: 0
  }
  const bin = resolveFfmpegPath()
  if (!bin) return { ranges: [], analysis }

  let args: string[]
  if (mode === 'silence') {
    const audio = await measureAudio(filePath)
    analysis.hasAudio = audio.hasAudio
    analysis.maxDb = audio.maxDb
    if (!audio.hasAudio) return { ranges: [], analysis }
    // "Silence" = well below this clip's own loudest moment. Also stay clearly
    // under the clip's AVERAGE level, so a mostly-quiet recording with one
    // loud spike doesn't get most of itself flagged as dead air. Clamped so a
    // whisper-quiet or fully clipped recording still behaves sensibly.
    const thresholdDb = Math.min(
      -16,
      Math.max(-55, Math.min(audio.maxDb - t.dropDb, audio.meanDb - 6))
    )
    analysis.thresholdDb = thresholdDb
    args = ['-hide_banner', '-i', filePath, '-af', `silencedetect=noise=${thresholdDb}dB:d=${t.minDeadSec}`, '-vn', '-f', 'null', '-']
  } else {
    args = ['-hide_banner', '-i', filePath, '-vf', `freezedetect=n=${t.freezeNoiseDb}dB:d=${t.freezeSec}`, '-an', '-f', 'null', '-']
  }

  const stderr = await new Promise<string>((resolve) => {
    execFile(bin, args, { maxBuffer: 1024 * 1024 * 64 }, (_err, _stdout, se) => resolve(se || ''))
  })
  const ranges: [number, number][] = []
  if (mode === 'silence') {
    const starts = [...stderr.matchAll(/silence_start:\s*([0-9.]+)/g)].map((m) => parseFloat(m[1]))
    const ends = [...stderr.matchAll(/silence_end:\s*([0-9.]+)/g)].map((m) => parseFloat(m[1]))
    for (let i = 0; i < starts.length; i++) {
      // A silence that runs to EOF has no silence_end line.
      ranges.push([starts[i], ends[i] ?? totalSec])
    }
  } else {
    const starts = [...stderr.matchAll(/freeze_start:\s*([0-9.]+)/g)].map((m) => parseFloat(m[1]))
    const ends = [...stderr.matchAll(/freeze_end:\s*([0-9.]+)/g)].map((m) => parseFloat(m[1]))
    for (let i = 0; i < starts.length; i++) ranges.push([starts[i], ends[i] ?? totalSec])
  }
  const cleaned = ranges.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0])
  analysis.deadCount = cleaned.length
  return { ranges: cleaned, analysis }
}

export interface AutoClipOutput {
  outputDir: string
  clips: { path: string; startSec: number; endSec: number }[]
  removedSec: number
  totalSec: number
  analysis?: AutoClipAnalysis
}

// Cut the useless parts out of a clip: detect dead intervals, keep the rest
// (with a little breathing room), and stage each kept segment in the tray as
// its own lossless stream-copied file.
export async function autoClip(
  filePath: string,
  baseName: string,
  opts: { mode?: AutoClipMode; strength?: AutoClipStrength } = {}
): Promise<AutoClipOutput> {
  if (!ensureFfmpeg()) return { outputDir: '', clips: [], removedSec: 0, totalSec: 0 }
  const info = await getMediaInfo(filePath)
  const total = info.durationSec || 0
  if (total <= 0) return { outputDir: '', clips: [], removedSec: 0, totalSec: 0 }
  const mode = opts.mode ?? 'silence'
  const strength = opts.strength ?? 'balanced'

  const { ranges: dead, analysis } = await detectDeadRanges(filePath, mode, strength, total)
  if (dead.length === 0) return { outputDir: '', clips: [], removedSec: 0, totalSec: total, analysis }

  // Invert dead intervals into keep-segments, pad them so cuts don't clip
  // words/motion, then merge overlaps and drop blink-length slivers.
  const PAD = 0.25
  const MIN_KEEP = 0.6
  const MERGE_GAP = 0.3
  let keeps: [number, number][] = []
  let cursor = 0
  for (const [s, e] of dead) {
    if (s > cursor) keeps.push([cursor, s])
    cursor = Math.max(cursor, e)
  }
  if (cursor < total) keeps.push([cursor, total])
  keeps = keeps.map(([a, b]) => [Math.max(0, a - PAD), Math.min(total, b + PAD)])
  const merged: [number, number][] = []
  for (const k of keeps) {
    const last = merged[merged.length - 1]
    if (last && k[0] - last[1] < MERGE_GAP) last[1] = Math.max(last[1], k[1])
    else merged.push([k[0], k[1]])
  }
  const finalKeeps = merged.filter(([a, b]) => b - a >= MIN_KEEP)
  if (finalKeeps.length === 0)
    return { outputDir: '', clips: [], removedSec: total, totalSec: total, analysis }

  const ext = path.extname(filePath).slice(1).toLowerCase() || 'mp4'
  const name = sanitizeName(baseName)
  const outputDir = path.join(stagingDir(), `${name} auto-clipped`)
  await fs.mkdir(outputDir, { recursive: true })

  // Frame-accurate cuts require a re-encode: stream copy can only start on a
  // keyframe, which silently drags the removed dead air back in whenever a cut
  // lands mid-GOP (most of the time). veryfast x264 keeps this quick.
  const hasVideo = info.width > 0
  const cutOpts = hasVideo
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-avoid_negative_ts', 'make_zero']
    : ['-avoid_negative_ts', 'make_zero']

  const clips: { path: string; startSec: number; endSec: number }[] = []
  let idx = 0
  for (const [s, e] of finalKeeps) {
    idx++
    const out = path.join(outputDir, `${name}-keep-${String(idx).padStart(2, '0')}.${ext}`)
    const ok = await new Promise<boolean>((resolve) => {
      ffmpeg(filePath)
        .seekInput(s)
        .duration(Math.max(0.1, e - s))
        .outputOptions(cutOpts)
        .on('error', () => resolve(false))
        .on('end', () => resolve(true))
        .save(out)
    })
    if (ok) clips.push({ path: out, startSec: s, endSec: e })
  }
  const kept = finalKeeps.reduce((acc, [a, b]) => acc + (b - a), 0)
  return { outputDir, clips, removedSec: Math.max(0, total - kept), totalSec: total, analysis }
}

export async function cleanupTemp(): Promise<void> {
  const dir = path.join(os.tmpdir(), 'cliprename')
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
}
