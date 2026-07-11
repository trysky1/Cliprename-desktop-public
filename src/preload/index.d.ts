import type { ClipRenameApi } from './index'

declare global {
  interface Window {
    api: ClipRenameApi
  }
}

export {}
