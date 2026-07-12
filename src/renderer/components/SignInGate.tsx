import React, { useState } from 'react'
import logo from '../assets/logo.png'
import { friendlyAuthError } from '../lib/authError'

interface CloudState {
  signedIn: boolean
  email: string
  tier: string
}

interface Props {
  onSignedIn: (cloud: CloudState) => void
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

// Full-screen sign-in wall: the app is a companion to cliprename.com, and every
// feature draws on the account's plan (AI credits, quotas, billing) — so the
// whole app is gated behind the same login as the website.
export default function SignInGate({ onSignedIn }: Props): React.ReactElement {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function doGoogle(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      const s = await window.api.cloudSignInGoogle()
      if (s.signedIn) onSignedIn(s)
    } catch (e) {
      setError(friendlyAuthError(e))
    } finally {
      setBusy(false)
    }
  }

  async function doSignIn(): Promise<void> {
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const s = await window.api.cloudSignIn(email.trim(), password)
      if (s.signedIn) onSignedIn(s)
    } catch (e) {
      setError(friendlyAuthError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid h-full place-items-center p-6">
      <div className="card w-full max-w-sm p-7">
        <div className="mb-5 flex flex-col items-center gap-3 text-center">
          <img src={logo} alt="ClipRename" className="h-14 w-14 rounded-2xl shadow-soft" />
          <div>
            <div className="text-lg font-semibold text-text">Sign in to ClipRename</div>
            <div className="mt-1 text-[12px] leading-relaxed text-muted">
              Use your cliprename.com account — your plan, credits, and limits carry over
              automatically.
            </div>
          </div>
        </div>

        <button
          onClick={doGoogle}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2.5 rounded-md border border-borderSoft bg-text px-4 py-2.5 text-[13px] font-medium text-mint-ink transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          <GoogleMark />
          {busy ? 'Waiting for your browser…' : 'Continue with Google'}
        </button>

        <div className="my-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-faint">
          <span className="h-px flex-1 bg-borderSoft" />
          or with email
          <span className="h-px flex-1 bg-borderSoft" />
        </div>

        <div className="space-y-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSignIn()}
            placeholder="Email"
            autoComplete="email"
            className="field"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSignIn()}
            placeholder="Password"
            autoComplete="current-password"
            className="field"
          />
          {error && <div className="text-[12px] text-danger">{error}</div>}
          <button onClick={doSignIn} disabled={busy} className="btn-primary w-full !py-2.5 text-sm">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>

        <div className="mt-4 space-y-1.5 text-center">
          <button
            onClick={() => window.api.openExternal('https://cliprename.com/auth')}
            className="text-[12px] text-mint hover:underline"
          >
            New here? Create a free account on cliprename.com
          </button>
          <div className="text-[10px] leading-relaxed text-faint">
            If you joined with Google, use the Google button — email sign-in only works for
            accounts with a password.
          </div>
          <div className="text-[10px] leading-relaxed text-faint">
            By signing in you agree to ClipRename’s{' '}
            <button
              onClick={() => window.api.openExternal('https://cliprename.com/terms')}
              className="underline hover:text-muted"
            >
              Terms
            </button>{' '}
            and{' '}
            <button
              onClick={() => window.api.openExternal('https://cliprename.com/privacy')}
              className="underline hover:text-muted"
            >
              Privacy Policy
            </button>
            . To generate names, small media samples (a few video frames, a downscaled image, or a
            short audio excerpt) are sent to ClipRename’s servers for AI analysis.
          </div>
        </div>
      </div>
    </div>
  )
}
