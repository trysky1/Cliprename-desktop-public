// ClipRename account — connects the desktop app to the SAME Supabase project
// as cliprename.com. Users sign in with their existing website account; AI
// calls then go through the website's own edge functions (analyze-frame /
// analyze-image / analyze-audio), which authenticate the user, resolve their
// Stripe plan, and enforce the same daily/monthly quotas as the website.
//
// No secret keys live here: the URL and anon key below are the same PUBLIC
// values shipped in the website's own browser bundle. The Lovable/Stripe
// secrets stay server-side in the edge functions.

import { BrowserWindow, shell } from 'electron'
import Store from 'electron-store'
import http from 'http'
import crypto from 'crypto'
import { decryptSecret, encryptSecret } from './secureStore'

const SUPABASE_URL = 'https://rjafhyuhjohbqnthbjxd.supabase.co'
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqYWZoeXVoam9oYnFudGhianhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MTI5OTEsImV4cCI6MjA5MTQ4ODk5MX0.NarVJi8RHSGsyhvTY6ldXJvcqZjTNum2vKFQQe_oBKk'

// Stripe product ids → plan names (mirrors the website's useSubscription and
// _shared/quota.ts, including the retired Ultra product treated as Max).
const PRODUCT_TIERS: Record<string, string> = {
  prod_UKNdA89j1dWEuY: 'pro',
  prod_UKNdaAdGmijmje: 'business',
  prod_UKNdDJ9v3kyau1: 'max', // legacy $67 Max
  prod_UcX5aHTQ3A50ng: 'max',
  prod_UelQA0zP3zoqwe: 'max' // retired Ultra — kept as Max like the server does
}

interface CloudSession {
  accessToken: string
  refreshToken: string
  expiresAt: number // unix seconds
  email: string
  userId?: string
}

export interface CloudStatus {
  signedIn: boolean
  email: string
  tier: string // 'free' | 'pro' | 'business' | 'max' | '' when signed out
  // Set when the plan lookup FAILED (network/server) — the tier is then
  // unknown, not actually 'free'; the UI offers a retry instead of lying.
  planError?: string
  // Account has the `sandbox` tester role (user_roles table). The website
  // treats these accounts as Max (UI + server quota bypass) — so do we.
  tester?: boolean
}

// Published plan allowances — mirrors the cliprename.com pricing page and the
// server's _shared/quota.ts. The server stays the source of truth; these are
// for display, exactly like the website's dashboard.
const TIER_DAILY: Record<string, number> = { free: 5, pro: 100, business: 500, max: 2500 }
const TIER_MONTHLY: Record<string, number> = { free: 25, pro: 1000, business: 5000, max: 25000 }

export interface CloudUsage {
  tier: string
  daily: number
  dailyLimit: number
  monthly: number
  monthlyLimit: number
}

// The session blob (access/refresh tokens) is stored encrypted at rest via
// the OS keychain (safeStorage) — electron-store's own file is plaintext JSON
// otherwise, and these tokens grant the same account access as a real login.
const store = new Store<{ session: string | null }>({
  name: 'cliprename-account',
  defaults: { session: null }
})

function getSession(): CloudSession | null {
  const raw = store.get('session')
  if (!raw) return null
  const decrypted = decryptSecret(raw)
  if (!decrypted) return null
  try {
    return JSON.parse(decrypted) as CloudSession
  } catch {
    return null
  }
}

function setSession(s: CloudSession | null): void {
  store.set('session', s ? encryptSecret(JSON.stringify(s)) : null)
}

export function isSignedIn(): boolean {
  return !!getSession()
}

async function authRequest(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify(body)
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const msg =
      (json['error_description'] as string) ||
      (json['msg'] as string) ||
      (json['error'] as string) ||
      res.statusText
    throw new Error(msg)
  }
  return json
}

function saveTokens(json: Record<string, unknown>, fallbackEmail: string): CloudSession {
  const user = json['user'] as { email?: string; id?: string } | undefined
  const session: CloudSession = {
    accessToken: String(json['access_token'] || ''),
    refreshToken: String(json['refresh_token'] || ''),
    expiresAt: Number(json['expires_at'] || Math.floor(Date.now() / 1000) + 3000),
    email: user?.email || fallbackEmail,
    userId: user?.id || getSession()?.userId
  }
  if (!session.accessToken) throw new Error('Sign-in did not return a session.')
  setSession(session)
  return session
}

export async function signIn(email: string, password: string): Promise<CloudStatus> {
  const json = await authRequest('token?grant_type=password', { email, password })
  saveTokens(json, email)
  return status()
}

export function signOut(): void {
  setSession(null)
}

// ---------- Sign in via the website (works with Google & anything else) ----------
// cliprename.com logs users in through Lovable's MANAGED OAuth proxy — Google
// credentials live on Lovable's side, not in this Supabase project (its GoTrue
// google provider is unconfigured: "missing OAuth secret"). So the desktop
// can't run OAuth itself. Instead: open cliprename.com/desktop-auth in the
// system browser; the user signs in there exactly like on the website; the
// page then POSTs the Supabase session to a one-shot listener on localhost.
// Same account, same tokens — and any provider the website supports.

const HANDOFF_PORT = 53682
const HANDOFF_TIMEOUT_MS = 5 * 60 * 1000
const HANDOFF_ORIGIN = 'https://cliprename.com'

interface HandoffTokens {
  access_token?: string
  refresh_token?: string
  expires_at?: number
  email?: string
  state?: string
}

export async function signInWithGoogle(): Promise<CloudStatus> {
  // Single-use random nonce: the website page must echo this back in the POST
  // body, so a malicious local page that merely guesses the well-known port
  // can't fixate the desktop app onto an attacker-controlled session during
  // the few minutes the listener is open.
  const state = crypto.randomBytes(24).toString('hex')
  const desktopAuthUrl = `${HANDOFF_ORIGIN}/desktop-auth?port=${HANDOFF_PORT}&state=${state}`

  const tokens = await new Promise<HandoffTokens>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const origin = req.headers.origin
      // Only the real cliprename.com page is allowed to talk to this listener.
      const originOk = origin === HANDOFF_ORIGIN
      const cors = originOk
        ? {
            'Access-Control-Allow-Origin': HANDOFF_ORIGIN,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
          }
        : {}
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors)
        res.end()
        return
      }
      if (!originOk || req.method !== 'POST' || !(req.url || '').startsWith('/token')) {
        res.writeHead(404, cors)
        res.end()
        return
      }
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk
        if (raw.length > 64_000) req.destroy() // sanity cap
      })
      req.on('end', () => {
        try {
          const body = JSON.parse(raw) as HandoffTokens
          if (!body.access_token || !body.refresh_token) throw new Error('missing tokens')
          if (body.state !== state) throw new Error('state mismatch')
          res.writeHead(200, { ...cors, 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
          clearTimeout(timer)
          server.close()
          resolve(body)
        } catch {
          res.writeHead(400, { ...cors, 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'invalid token payload' }))
        }
      })
    })
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('Sign-in timed out. Please try again.'))
    }, HANDOFF_TIMEOUT_MS)
    server.on('error', () => {
      clearTimeout(timer)
      reject(new Error('Could not listen for the sign-in (is another copy of the app open?).'))
    })
    server.listen(HANDOFF_PORT, '127.0.0.1', () => {
      shell.openExternal(desktopAuthUrl)
    })
  })

  setSession({
    accessToken: tokens.access_token as string,
    refreshToken: tokens.refresh_token as string,
    expiresAt: Number(tokens.expires_at || Math.floor(Date.now() / 1000) + 3000),
    email: tokens.email || ''
  })
  // Bring the app back to the front after the browser round-trip.
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  return status()
}

async function freshAccessToken(): Promise<string> {
  const s = getSession()
  if (!s) throw new Error('Not signed in to ClipRename.')
  // Refresh a minute early so in-flight calls never race expiry.
  if (s.expiresAt - 60 > Math.floor(Date.now() / 1000)) return s.accessToken
  try {
    const json = await authRequest('token?grant_type=refresh_token', {
      refresh_token: s.refreshToken
    })
    return saveTokens(json, s.email).accessToken
  } catch (e) {
    setSession(null) // refresh token rejected → force a clean re-login
    throw new Error('Your ClipRename session expired. Please sign in again in Settings.')
  }
}

// Call one of the website's edge functions as the signed-in user. The function
// itself authenticates the JWT, resolves the user's Stripe plan, and enforces
// the same quotas as the website — so plans "just work" here.
export async function callFunction(
  name: string,
  body: unknown
): Promise<Record<string, unknown>> {
  const token = await freshAccessToken()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY
    },
    body: JSON.stringify(body)
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const detail = (json['error'] as string) || res.statusText
    if (res.status === 429 && json['code'] === 'QUOTA_EXCEEDED') {
      throw new Error(`${detail} Upgrade your plan on cliprename.com to continue.`)
    }
    if (res.status === 429) throw new Error('Slow down a little — too many requests at once.')
    if (res.status === 401) throw new Error('Your session expired. Sign in again in Settings.')
    if (res.status === 402) throw new Error('ClipRename AI is out of credit right now. Please try again later.')
    throw new Error(`ClipRename AI error: ${detail}`)
  }
  return json
}

// Mirrors the website's useSandbox hook: the `sandbox` role in user_roles
// marks tester accounts that the website (and server quota) treat as Max.
async function hasSandboxRole(): Promise<boolean> {
  const uid = await userId()
  const token = await freshAccessToken()
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/user_roles?select=role&user_id=eq.${encodeURIComponent(uid)}&role=eq.sandbox`,
    { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY } }
  )
  if (!res.ok) return false
  const rows = (await res.json().catch(() => [])) as unknown[]
  return Array.isArray(rows) && rows.length > 0
}

export async function status(): Promise<CloudStatus> {
  const s = getSession()
  if (!s) return { signedIn: false, email: '', tier: '' }
  const tester = await hasSandboxRole().catch(() => false)
  try {
    const sub = await callFunction('check-subscription', {})
    const productId = (sub['product_id'] as string) || ''
    let tier = sub['subscribed'] ? PRODUCT_TIERS[productId] || 'pro' : 'free'
    // Website parity (Dashboard: isMax = isSandbox || subscription.isMax):
    // tester accounts count as Max even with no Stripe subscription.
    if (tester && tier === 'free') tier = 'max'
    return { signedIn: true, email: s.email, tier, tester }
  } catch (e) {
    // If the failure was a rejected refresh token, freshAccessToken already
    // cleared the session — report signed-out instead of a phantom logged-in
    // state that lets the user past the gate into an app where everything errors.
    if (!getSession()) return { signedIn: false, email: '', tier: '' }
    // Otherwise the plan lookup just failed (network/server). A confirmed tester
    // is still Max; else the tier is UNKNOWN — surface it so the UI offers retry.
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[cloud] check-subscription failed:', msg)
    if (tester) return { signedIn: true, email: s.email, tier: 'max', tester }
    return { signedIn: true, email: s.email, tier: 'free', planError: msg }
  }
}

async function userId(): Promise<string> {
  const s = getSession()
  if (!s) throw new Error('Not signed in to ClipRename.')
  if (s.userId) return s.userId
  // Older sessions (or the website handoff) may lack the id — fetch it once.
  const token = await freshAccessToken()
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY }
  })
  const json = (await res.json().catch(() => ({}))) as { id?: string; email?: string }
  if (!res.ok || !json.id) throw new Error('Could not load your account profile.')
  setSession({ ...s, userId: json.id, email: s.email || json.email || '' })
  return json.id
}

// Count this user's rows in usage_logs since `sinceIso` — the IDENTICAL query
// the website dashboard runs (count head request, RLS-scoped), so the app and
// the website always show the same numbers.
async function countUsageSince(uid: string, sinceIso: string): Promise<number> {
  const token = await freshAccessToken()
  const url =
    `${SUPABASE_URL}/rest/v1/usage_logs?select=*` +
    `&user_id=eq.${encodeURIComponent(uid)}` +
    `&created_at=gte.${encodeURIComponent(sinceIso)}`
  const res = await fetch(url, {
    method: 'HEAD',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      Prefer: 'count=exact'
    }
  })
  if (!res.ok) throw new Error('Could not load your usage.')
  // content-range: "0-24/123" or "*/0" — the total sits after the slash.
  const range = res.headers.get('content-range') || ''
  const total = Number(range.split('/').pop())
  return Number.isFinite(total) ? total : 0
}

// Today / this-month usage vs the signed-in user's plan allowance — mirrors
// the website's dashboard counters ("X of 25,000 files this month").
export async function usage(): Promise<CloudUsage> {
  const uid = await userId()
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)
  const [st, daily, monthly] = await Promise.all([
    status(),
    countUsageSince(uid, startOfDay.toISOString()),
    countUsageSince(uid, startOfMonth.toISOString())
  ])
  const tier = st.tier || 'free'
  return {
    tier,
    daily,
    dailyLimit: TIER_DAILY[tier] ?? TIER_DAILY.free,
    monthly,
    monthlyLimit: TIER_MONTHLY[tier] ?? TIER_MONTHLY.free
  }
}

// Stripe customer portal (manage/cancel/upgrade) — returns a URL to open in
// the system browser. Mirrors the website's "Manage subscription" button.
export async function portalUrl(): Promise<string> {
  const json = await callFunction('customer-portal', {})
  const url = (json['url'] as string) || ''
  if (!url) throw new Error('Could not open the billing portal.')
  return url
}
