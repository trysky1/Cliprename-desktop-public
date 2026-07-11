import Store from 'electron-store'
import { AppSettings, DEFAULT_SETTINGS, Preset, WatchHistoryEntry, WatchRule } from '../shared/types'

const store = new Store<{
  settings: AppSettings
  presets: Preset[]
  watchRules: WatchRule[]
  watchHistory: WatchHistoryEntry[]
}>({
  defaults: { settings: DEFAULT_SETTINGS, presets: [], watchRules: [], watchHistory: [] },
  name: 'cliprename-settings'
})

export function getSettings(): AppSettings {
  // Merge with defaults so new keys are always present after upgrades.
  return { ...DEFAULT_SETTINGS, ...store.get('settings') }
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch }
  store.set('settings', next)
  return next
}

// ---- Preset recipes (saved naming/organizing pipelines) ----
export function getPresets(): Preset[] {
  return store.get('presets') ?? []
}

export function savePreset(preset: Preset): Preset[] {
  const list = getPresets().filter((p) => p.id !== preset.id)
  list.push(preset)
  store.set('presets', list)
  return list
}

export function deletePreset(id: string): Preset[] {
  const list = getPresets().filter((p) => p.id !== id)
  store.set('presets', list)
  return list
}

// ---- Watch-folder automation rules ----
export function getWatchRules(): WatchRule[] {
  return store.get('watchRules') ?? []
}

export function saveWatchRule(rule: WatchRule): WatchRule[] {
  const list = getWatchRules()
  const idx = list.findIndex((r) => r.id === rule.id)
  // Replace in place so editing/pausing a rule doesn't make its row jump to the
  // bottom of the list; only genuinely new rules are appended.
  if (idx >= 0) list[idx] = rule
  else list.push(rule)
  store.set('watchRules', list)
  return list
}

export function deleteWatchRule(id: string): WatchRule[] {
  const list = getWatchRules().filter((r) => r.id !== id)
  store.set('watchRules', list)
  // The rule is gone — its rename history is meaningless now, drop it too.
  store.set(
    'watchHistory',
    getWatchHistory().filter((h) => h.ruleId !== id)
  )
  return list
}

// ---- Rename history (what each watched folder actually changed) ----
const HISTORY_CAP = 500 // across all rules — plenty for "what happened lately"

export function getWatchHistory(ruleId?: string): WatchHistoryEntry[] {
  const all = store.get('watchHistory') ?? []
  return ruleId ? all.filter((h) => h.ruleId === ruleId) : all
}

export function addWatchHistory(entry: WatchHistoryEntry): void {
  const all = getWatchHistory()
  all.push(entry)
  if (all.length > HISTORY_CAP) all.splice(0, all.length - HISTORY_CAP)
  store.set('watchHistory', all)
}
