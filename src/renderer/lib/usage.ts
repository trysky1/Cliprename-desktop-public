// Local usage counters (v1, no backend). Mirrors cliprename.com's Today / This month panel.
// When the app is connected to cliprename.com later, this is replaced by the shared Supabase quota.

interface UsageState {
  day: string
  dayCount: number
  month: string
  monthCount: number
}

const KEY = 'cliprename.usage'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}
function thisMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

export function getUsage(): UsageState {
  let s: UsageState
  try {
    s = JSON.parse(localStorage.getItem(KEY) || '')
  } catch {
    s = { day: today(), dayCount: 0, month: thisMonth(), monthCount: 0 }
  }
  if (s.day !== today()) {
    s.day = today()
    s.dayCount = 0
  }
  if (s.month !== thisMonth()) {
    s.month = thisMonth()
    s.monthCount = 0
  }
  return s
}

export function addUsage(n: number): UsageState {
  const s = getUsage()
  s.dayCount += n
  s.monthCount += n
  localStorage.setItem(KEY, JSON.stringify(s))
  return s
}
