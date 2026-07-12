import React, { useEffect, useState } from 'react'
import { UpdateCheckResult } from '../../shared/types'
import { IconUser } from './Icons'
import { friendlyAuthError } from '../lib/authError'
import { useEscape } from '../lib/useEscape'

interface Props {
  ffmpegOk: boolean
  onClose: () => void
  onOpenExternal: (url: string) => void
}

interface CloudStatus {
  signedIn: boolean
  email: string
  tier: string
  planError?: string
  tester?: boolean
}

const TIER_LABEL: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  business: 'Business',
  max: 'Max'
}

// Usage meter row — mirrors the website dashboard ("X of Y files").
function UsageBar({
  label,
  used,
  limit
}: {
  label: string
  used: number
  limit: number
}): React.ReactElement {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  const over = limit > 0 && used > limit
  const warn = pct >= 80
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-muted">{label}</span>
        <span className={over ? 'text-danger' : warn ? 'text-warning' : 'text-faint'}>
          {used.toLocaleString()} of {limit.toLocaleString()} files
          {over ? ' — over plan limit' : ''}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface2">
        <div
          className={`h-full rounded-full transition-all ${over ? 'bg-danger' : warn ? 'bg-warning' : 'bg-mint'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// Check for + apply new versions right inside the app — no reinstall dance.
function UpdateSection(): React.ReactElement {
  const [check, setCheck] = useState<UpdateCheckResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [percent, setPercent] = useState<number | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    return window.api.onUpdateProgress((p) => {
      if (p.error) {
        setError(p.error)
        setPercent(null)
        return
      }
      if (typeof p.percent === 'number') setPercent(p.percent)
      if (p.ready) setReady(true)
    })
  }, [])

  async function doCheck(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      setCheck(await window.api.updateCheck())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function doDownload(): Promise<void> {
    setError('')
    setPercent(0)
    try {
      await window.api.updateDownload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPercent(null)
    }
  }

  return (
    <div className="rounded-xl border border-borderSoft bg-surface2 p-4">
      <div className="mb-1 flex items-center justify-between">
        <div className="font-medium text-text">App updates</div>
        {check && <span className="chip !py-0.5 text-[10px]">v{check.current}</span>}
      </div>

      {!check ? (
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-muted">Get new versions without reinstalling.</span>
          <button onClick={doCheck} disabled={busy} className="btn !py-1.5 !px-3 text-xs">
            {busy ? 'Checking…' : 'Check for updates'}
          </button>
        </div>
      ) : check.devMode ? (
        <div className="text-[12px] text-muted">Running from source — updates apply to installed builds.</div>
      ) : check.note ? (
        <div className="space-y-2">
          <div className="text-[12px] text-muted">{check.note}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.api.updateOpen(check.pageUrl)}
              className="btn !py-1.5 !px-3 text-xs"
            >
              Open download page
            </button>
            <button onClick={doCheck} disabled={busy} className="btn-ghost !py-1 !px-2 text-[11px]">
              Try again
            </button>
          </div>
        </div>
      ) : !check.available ? (
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-mint">You’re on the newest version.</span>
          <button onClick={doCheck} disabled={busy} className="btn-ghost !py-1 !px-2 text-[11px]">
            Check again
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-[12px] text-muted">
            <span className="text-mint">Version {check.latest} is out</span> — you have {check.current}.
          </div>
          {check.canSelfUpdate ? (
            ready ? (
              <div className="space-y-1.5">
                <div className="text-[12px] text-mint">
                  ✓ Downloaded — restarting to finish the update…
                </div>
                <button
                  onClick={() => window.api.updateInstall()}
                  className="btn !py-1.5 !px-3 text-xs"
                >
                  Restart now
                </button>
              </div>
            ) : percent !== null ? (
              <div>
                <div className="mb-1 text-[11px] text-muted">
                  Downloading… {percent}% — the app restarts itself when it’s done.
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
                  <div className="h-full rounded-full bg-mint transition-all" style={{ width: `${percent}%` }} />
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <button onClick={doDownload} className="btn-primary !py-1.5 !px-3 text-xs">
                  Update now
                </button>
                <div className="text-[10px] text-faint">
                  Downloads in the background, then restarts the app on the new version —
                  nothing else to do.
                </div>
              </div>
            )
          ) : (
            <div className="space-y-1.5">
              <button
                onClick={() => window.api.updateOpen(check.downloadUrl || check.pageUrl)}
                className="btn-primary !py-1.5 !px-3 text-xs"
              >
                Get the new version
              </button>
              <div className="text-[10px] text-faint">
                This older release can’t update itself — the download opens in your browser;
                drag ClipRename to Applications to replace the old one. Every release from
                here on updates with one click.
              </div>
            </div>
          )}
        </div>
      )}
      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
    </div>
  )
}

// Official Google "G" mark (brand-correct colors), used only on the sign-in button.
function GoogleMark(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

export default function SettingsModal({
  ffmpegOk,
  onClose,
  onOpenExternal
}: Props): React.ReactElement {
  const [cloud, setCloud] = useState<CloudStatus>({ signedIn: false, email: '', tier: '' })
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [appVersion, setAppVersion] = useState('')
  useEscape(onClose)
  const [usage, setUsage] = useState<{
    daily: number
    dailyLimit: number
    monthly: number
    monthlyLimit: number
  } | null>(null)

  function loadUsage(): void {
    window.api
      .cloudUsage()
      .then((u) => setUsage(u))
      .catch(() => setUsage(null))
  }

  useEffect(() => {
    window.api.appVersion().then(setAppVersion).catch(() => {})
    window.api
      .cloudStatus()
      .then((s) => {
        setCloud(s)
        if (s.signedIn) loadUsage()
      })
      .catch(() => {})
  }, [])

  async function doGoogle(): Promise<void> {
    setAuthBusy(true)
    setAuthError('')
    try {
      const s = await window.api.cloudSignInGoogle()
      setCloud(s)
      if (s.signedIn) loadUsage()
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e))
    } finally {
      setAuthBusy(false)
    }
  }

  async function doSignIn(): Promise<void> {
    if (!loginEmail.trim() || !loginPassword) {
      setAuthError('Enter your email and password.')
      return
    }
    setAuthBusy(true)
    setAuthError('')
    try {
      const s = await window.api.cloudSignIn(loginEmail.trim(), loginPassword)
      setCloud(s)
      if (s.signedIn) loadUsage()
      setLoginPassword('')
    } catch (e) {
      setAuthError(friendlyAuthError(e))
    } finally {
      setAuthBusy(false)
    }
  }

  async function doSignOut(): Promise<void> {
    await window.api.cloudSignOut()
    setCloud({ signedIn: false, email: '', tier: '' })
    setUsage(null)
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="card w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between border-b border-borderSoft px-6 py-4">
          <div className="section-title">Settings</div>
          <button onClick={onClose} className="btn-ghost text-lg">
            ✕
          </button>
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-auto px-6 py-5 text-sm">
          {/* ClipRename account — same login, plan & limits as cliprename.com */}
          <div className="rounded-xl border border-mint/30 bg-mint/5 p-4">
            <div className="mb-1 flex items-center gap-2 font-medium text-mint">
              <IconUser size={15} /> ClipRename account
            </div>
            {cloud.signedIn ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-text">{cloud.email}</span>
                  {cloud.planError ? (
                    <span className="chip !border-warning/40 !text-warning">plan unknown</span>
                  ) : (
                    <span className="chip">
                      {TIER_LABEL[cloud.tier] || 'Free'} plan
                      {cloud.tester ? ' · tester' : ''}
                    </span>
                  )}
                </div>
                {cloud.planError && (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[12px] text-warning">
                    <span>Couldn’t check your plan: {cloud.planError}</span>
                    <button
                      onClick={() => {
                        window.api.cloudStatus().then(setCloud).catch(() => {})
                        loadUsage()
                      }}
                      className="btn !py-1 !px-2 text-[11px]"
                    >
                      Retry
                    </button>
                  </div>
                )}
                {!cloud.planError && !cloud.tester && cloud.tier === 'free' && (
                  <div className="rounded-lg border border-borderSoft bg-surface px-3 py-2 text-[11px] text-muted">
                    Bought a plan but see Free? Your subscription is looked up by email — make
                    sure you signed in here with the same email your plan was purchased under.
                  </div>
                )}
                <div className="text-[12px] text-muted">
                  AI naming runs through your account — no key needed. Your plan’s daily and
                  monthly limits apply, the same as on cliprename.com.
                </div>
                {usage && (
                  <div className="space-y-2 rounded-lg border border-borderSoft bg-surface px-3 py-2.5">
                    <UsageBar label="Today" used={usage.daily} limit={usage.dailyLimit} />
                    <UsageBar label="This month" used={usage.monthly} limit={usage.monthlyLimit} />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-faint">
                        Same counters as your cliprename.com dashboard
                      </span>
                      <button onClick={loadUsage} className="text-[11px] text-mint hover:underline">
                        Refresh
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => onOpenExternal('https://cliprename.com/home#pricing')}
                    className="btn !py-1.5 !px-3 text-xs"
                  >
                    Upgrade plan
                  </button>
                  {cloud.tier !== 'free' && (
                    <button
                      onClick={() => window.api.cloudPortal().catch(() => {})}
                      className="btn !py-1.5 !px-3 text-xs"
                    >
                      Manage billing
                    </button>
                  )}
                  <button onClick={doSignOut} className="btn-ghost !py-1.5 !px-3 text-xs">
                    Sign out
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="text-[12px] text-muted">
                  Sign in with your cliprename.com account and AI naming just works — no key,
                  no setup. Your plan and limits carry over automatically.
                </div>
                <button
                  onClick={doGoogle}
                  disabled={authBusy}
                  className="flex w-full items-center justify-center gap-2.5 rounded-md border border-borderSoft bg-text px-4 py-2.5 text-[13px] font-medium text-mint-ink transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  <GoogleMark />
                  {authBusy ? 'Waiting for your browser…' : 'Continue with Google'}
                </button>
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-faint">
                  <span className="h-px flex-1 bg-borderSoft" />
                  or with email
                  <span className="h-px flex-1 bg-borderSoft" />
                </div>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && doSignIn()}
                  placeholder="Email"
                  autoComplete="email"
                  className="field"
                />
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && doSignIn()}
                  placeholder="Password"
                  autoComplete="current-password"
                  className="field"
                />
                <div className="text-[11px] text-faint">
                  Email sign-in only works if your account has a password — if you joined with
                  Google, use the Google button above.
                </div>
                {authError && <div className="text-[12px] text-danger">{authError}</div>}
                <div className="flex items-center gap-3">
                  <button onClick={doSignIn} disabled={authBusy} className="btn !py-2 text-xs">
                    {authBusy ? 'Signing in…' : 'Sign in with email'}
                  </button>
                  <button
                    onClick={() => onOpenExternal('https://cliprename.com/auth')}
                    className="text-[12px] text-mint hover:underline"
                  >
                    Create an account on cliprename.com
                  </button>
                </div>
              </div>
            )}
          </div>

          <UpdateSection />

          <div className="rounded-xl border border-borderSoft bg-surface2 p-3 text-[13px] text-muted">
            <div>
              Reading inside videos &amp; audio:{' '}
              <span className={ffmpegOk ? 'text-mint' : 'text-peach'}>
                {ffmpegOk ? 'ready' : 'unavailable — names will be based on the old filename. Reinstalling ClipRename usually fixes this.'}
              </span>
            </div>
            <div className="mt-1 text-faint">
              AI naming runs entirely through your signed-in account — there's nothing to
              configure, and no key ever leaves cliprename.com's servers.
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-borderSoft px-6 py-4">
          <span className="text-[11px] text-faint">
            {appVersion ? `ClipRename v${appVersion}` : ''}
          </span>
          <button onClick={onClose} className="btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
