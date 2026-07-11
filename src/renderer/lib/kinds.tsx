import { MediaKind } from '../../shared/types'

export const KIND_META: Record<MediaKind, { icon: string; label: string; plural: string }> = {
  video: { icon: '🎬', label: 'Video', plural: 'videos' },
  audio: { icon: '🎵', label: 'Audio', plural: 'audio files' },
  image: { icon: '🖼️', label: 'Image', plural: 'images' },
  other: { icon: '📄', label: 'File', plural: 'other files' }
}

export function kindIcon(kind: MediaKind): string {
  return KIND_META[kind].icon
}
