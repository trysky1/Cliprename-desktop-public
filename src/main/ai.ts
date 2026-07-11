import { CATEGORIES, Category, MediaItem, NamingStyle, SortPlan } from '../shared/types'
import { callFunction } from './cloud'
import { MediaPart } from './media'

// ---------- Naming helpers ----------

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/['"]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function words(input: string): string[] {
  return slugify(input)
    .split('-')
    .filter(Boolean)
}

export function applyStyle(name: string, style: NamingStyle, dateMs?: number): string {
  const w = words(name)
  if (w.length === 0) return 'untitled'
  switch (style) {
    case 'snake-descriptive':
      return w.join('_')
    case 'title-spaces':
      return w.map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(' ')
    case 'dated-kebab': {
      const d = new Date(dateMs ?? 0)
      const iso = Number.isFinite(dateMs) && dateMs ? d.toISOString().slice(0, 10) : '0000-00-00'
      return `${iso}-${w.join('-')}`
    }
    case 'camera-scene':
    case 'kebab-descriptive':
    case 'generic':
    default:
      return w.join('-')
  }
}

// Words that carry no content meaning — camera/recording/export boilerplate.
const JUNK_TOKENS =
  /\b(img|dsc|vid|mvi|mov|gopr|gh|dji|pxl|clip|video|audio|movie|recording|rec|screen|screenshot|capture|grab|untitled|new|final|copy|export|render|output|sequence|seq|temp|tmp|wa|gmt|zoom|whatsapp|cam|footage)\b/gi

// True when a filename tells us nothing about the content — e.g. OBS timestamps
// ("2025-03-31 14-57-19", "02-15-16-30-53"), camera codes ("DSC_0001",
// "IMG_4523", "VID_0001"), pure numbers, or "Screen Recording 2025-…". After
// stripping that boilerplate, digits and separators, almost no real letters
// remain. Such names must never be echoed back as the suggested name.
export function isGenericFilename(name: string): boolean {
  const residue = name
    .replace(/\.[a-z0-9]+$/i, '') // drop extension
    .replace(/[_\-.]+/g, ' ') // separators → spaces
    .replace(/([a-z])(\d)/gi, '$1 $2') // split glued letter→digit ("DSC0001")
    .replace(/(\d)([a-z])/gi, '$1 $2') // split glued digit→letter ("GOPR0123")
    .replace(JUNK_TOKENS, ' ')
    .replace(/[0-9]+/g, ' ')
    .replace(/\b(at|on|am|pm)\b/gi, ' ')
    .replace(/[^a-zA-Z]+/g, '')
  return residue.length < 3
}

// An honest, content-kind label for files whose name tells us nothing offline.
function genericLabel(item: MediaItem): string {
  const n = item.baseName.toLowerCase()
  if (item.kind === 'image') return /screen|shot|capture|grab/.test(n) ? 'screenshot' : 'photo'
  if (item.kind === 'audio') return /voice|memo|note|dictation/.test(n) ? 'voice-memo' : 'audio-clip'
  if (item.kind === 'video') return /screen|rec(ord)?|capture|cast/.test(n) ? 'screen-recording' : 'video-clip'
  return 'clip'
}

// Offline name — used in Sandbox mode and whenever the AI call fails. Prefers a
// real embedded title (no AI needed), then a cleaned filename, and finally a
// kind-based label so a meaningless camera/timestamp code never becomes the name.
export function sandboxName(
  item: MediaItem,
  opts: { metaTitle?: string | null; style?: NamingStyle } = {}
): {
  name: string
  category: Category
  tags: string[]
  description: string
} {
  const meta = opts.metaTitle && !isGenericFilename(opts.metaTitle) ? opts.metaTitle.trim() : ''
  let base: string
  if (meta) {
    base = meta
  } else {
    const cleaned = item.baseName
      .replace(JUNK_TOKENS, ' ')
      .replace(/\b\d{4,}\b/g, ' ')
      .replace(/[_\-.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    base = cleaned.length >= 3 && !isGenericFilename(cleaned) ? cleaned : genericLabel(item)
  }
  const styled = opts.style ? applyStyle(base, opts.style, item.mtimeMs) : base
  const category: Category =
    item.kind === 'audio'
      ? 'music'
      : item.kind === 'image'
        ? 'product'
        : item.kind === 'video'
          ? 'broll'
          : 'other'
  return {
    name: styled || 'file',
    category,
    tags: [item.kind],
    description: meta ? `Embedded title: "${meta}".` : ''
  }
}

// ---------- ClipRename account (website edge functions) ----------

// The website's analyze-* functions use a wider category list than the app.
// Map what we can; anything unknown becomes 'other'.
const SITE_CATEGORY_MAP: Record<string, Category> = {
  indoors: 'interior',
  animals: 'nature',
  vehicles: 'urban',
  food: 'product',
  sports: 'people',
  tech: 'screen',
  meme: 'other'
}
function mapSiteCategory(c: string): Category {
  const lower = (c || '').toLowerCase()
  if ((CATEGORIES as readonly string[]).includes(lower)) return lower as Category
  return SITE_CATEGORY_MAP[lower] ?? 'other'
}

// Name a file through the user's cliprename.com account. The edge function
// authenticates the user, checks their Stripe plan's quota, and runs the same
// AI the website uses (it already recognizes celebrities and memes). The
// "group" for action sorting is the site's category (sports, food, ...).
export async function suggestNameCloud(
  item: MediaItem,
  media: MediaPart | MediaPart[] | null,
  opts: { ignoreFilename?: boolean; metaTitle?: string | null } = {}
): Promise<{ name: string; category: Category; tags: string[]; description: string; actionGroup?: string }> {
  const parts = Array.isArray(media) ? media.filter(Boolean) : media ? [media] : []
  // When the filename is a meaningless camera/timestamp code, never hand it to
  // the model (it would just echo it). Offer a real embedded title if we have
  // one, otherwise no hint at all so it names purely from the media.
  const goodMeta = opts.metaTitle && !isGenericFilename(opts.metaTitle) ? opts.metaTitle.trim() : ''
  const filenameHint = opts.ignoreFilename ? goodMeta : item.originalName

  // Nothing to look at AND no usable name: name it offline rather than asking
  // the filename analyzer to echo a timestamp back.
  if (!parts.length && !filenameHint) return sandboxName(item, { metaTitle: opts.metaTitle })

  let fn = 'analyze-filename'
  let body: Record<string, unknown> = { originalFilename: filenameHint }
  if (item.kind === 'video' && parts.length) {
    fn = 'analyze-frame'
    body = {
      frames: parts.map((p) => `data:${p.mimeType};base64,${p.data}`),
      originalFilename: filenameHint
    }
  } else if (item.kind === 'image' && parts.length) {
    fn = 'analyze-image'
    body = {
      imageBase64: `data:${parts[0].mimeType};base64,${parts[0].data}`,
      originalFilename: filenameHint
    }
  } else if (item.kind === 'audio' && parts.length) {
    fn = 'analyze-audio'
    body = {
      audioBase64: `data:${parts[0].mimeType};base64,${parts[0].data}`,
      originalFilename: filenameHint
    }
  }
  const r = await callFunction(fn, body)
  const raw = String(r['suggestedName'] || '')
  // If the model simply parroted a junk filename, drop it for a clean label.
  const echoedJunk = !!opts.ignoreFilename && !!raw && isGenericFilename(raw)
  const name = raw && !echoedJunk ? raw : sandboxName(item, { metaTitle: opts.metaTitle }).name
  const siteCategory = String(r['category'] || '')
  const people = String(r['people'] || '')
  const meme = String(r['meme'] || '')
  const tags = [
    ...people.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    ...(meme ? [meme.toLowerCase()] : []),
    ...(siteCategory ? [siteCategory.toLowerCase()] : [])
  ].slice(0, 5)
  const description = [people && `Features ${people}.`, meme && `Recognized as "${meme}".`]
    .filter(Boolean)
    .join(' ')
  return {
    name,
    category: mapSiteCategory(siteCategory),
    tags: tags.length ? tags : [item.kind],
    description,
    actionGroup: item.kind === 'video' ? (siteCategory || 'other').toLowerCase() : undefined
  }
}

// Chat sorting through the account: the website's chat-sort renames clips
// (it doesn't build folder layouts), so we surface it as a single rename plan.
export async function planSortCloud(instruction: string, items: MediaItem[]): Promise<SortPlan> {
  const clips = items.map((i) => ({
    id: i.id,
    suggestedName: i.suggestedName || '',
    originalName: i.originalName,
    category: i.category || '',
    people: '',
    metadata: i.description || ''
  }))
  const r = await callFunction('chat-sort', { message: instruction, clips })
  const renames = (r['renames'] as { id: string; newName: string }[] | undefined) ?? []
  const explanation = String(r['explanation'] || 'Here is what I can do.')
  if (!renames.length) {
    return { possible: false, reason: explanation, message: explanation, options: [] }
  }
  return {
    possible: true,
    reason: '',
    message: explanation,
    options: [
      {
        label: 'Apply these names',
        description: `Rename ${renames.length} files as suggested`,
        assignments: renames.map((x) => ({ id: x.id, targetFolder: '', suggestedName: x.newName }))
      }
    ]
  }
}

