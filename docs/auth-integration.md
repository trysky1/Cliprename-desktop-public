> **Internal engineering notes** — not user documentation.

# Auth Integration Reference (Phase 6)

How to connect the **ClipRename desktop app** to **cliprename.com** so they share
one Google login and the same accounts. This is the research backing Phase 6 of the
build plan. Nothing here is wired up yet — it's a pre-flight reference.

> Sources are cited inline. Items we could **not** verify from docs are listed at the
> bottom and must be confirmed in the live Lovable project.

---

## TL;DR

**Lovable Cloud is Supabase under the hood.** "Managed auth" just means Lovable owns
the Google OAuth client + credentials in front of a normal Supabase Auth (GoTrue)
instance — there is **no separate proprietary proxy protocol**.

➡️ **Do not hand-roll a Google PKCE flow in Electron.** Embed the Supabase JS client,
point it at the **same project URL + anon key** the web app uses, and call
`supabase.auth.signInWithOAuth(...)`. Both apps then authenticate against the same
GoTrue instance and the same `auth.users` accounts. That's the "one shared login" goal
with minimal custom code.

---

## Why the earlier custom PKCE attempt failed

It wasn't a literal network interceptor — it was a state/ownership mismatch:

1. **Wrong OAuth client.** In managed mode the only authorized redirect is
   `https://<project-ref>.supabase.co/auth/v1/callback`. A hand-rolled desktop redirect
   (custom scheme / loopback) isn't registered on Lovable's Google client, so Google
   rejects it or the code can't be exchanged.
2. **PKCE verifier locality.** Supabase requires the code→session exchange to complete
   in the same context that started it, using its own locally-stored verifier. A parallel
   flow's verifier won't match.
   (https://supabase.com/docs/guides/auth/sessions/pkce-flow)
3. **Hand-rolling yields Google tokens, not a Supabase session** → `supabase.auth.getUser()`
   returns 401. This is the exact symptom reported in the Supabase Electron discussions
   (https://github.com/orgs/supabase/discussions/17722).

---

## Recommended Electron pattern

```ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: false, // we handle the redirect ourselves in main
    persistSession: true
  }
})

// 1. Start sign-in WITHOUT navigating Electron itself:
const { data } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: { skipBrowserRedirect: true, redirectTo: REDIRECT_URL }
})

// 2. Open the URL in the SYSTEM browser (not an Electron BrowserWindow):
shell.openExternal(data.url)

// 3. Catch the redirect back into the app (see options below), then:
await supabase.auth.exchangeCodeForSession(code)
// (or setSession({ access_token, refresh_token }) if tokens come in the URL fragment)
```

- `skipBrowserRedirect` is documented as the non-browser path (React Native / Electron):
  https://supabase.com/docs/reference/javascript/auth-signinwithoauth

### Two ways to catch the redirect

| Option | How | Notes |
|---|---|---|
| **Custom URL scheme** (recommended) | `com.cliprename.app://auth/callback`; register via Electron `app.setAsDefaultProtocolClient` + handle `open-url` (macOS) and `second-instance` (Win/Linux); electron-builder `protocols` for packaged builds | Supabase's documented native pattern (https://supabase.com/docs/guides/auth/native-mobile-deep-linking). **Do not** let a BrowserWindow navigate to `app://…` directly — intercept the event, or you get `ERR_UNEXPECTED`. |
| **Loopback localhost** | tiny HTTP server in main on `http://localhost:<port>/callback` | Community-validated; simple, no OS protocol registration. |

> Note: Supabase's "native Google" `signInWithIdToken` path is documented for
> **Android/iOS only** — for Electron use the browser-based `signInWithOAuth` route above.

---

## Pre-flight checklist (must be true before login can work)

- [ ] Confirm backend type: **Lovable-managed Google creds** vs **your own Google creds**.
- [ ] Get the **Project URL** (`https://<ref>.supabase.co`) the web app uses.
- [ ] Get the **anon / publishable key** the web app uses (safe to ship — gated by RLS).
- [ ] Add the desktop **redirect** (custom scheme or loopback) to the **Additional Redirect
      URLs allowlist** (https://supabase.com/docs/guides/auth/redirect-urls).
- [ ] Set **Site URL** correctly for the web app.
- [ ] *(Own-creds only)* Google Cloud Console OAuth client type = **Web application**.
- [ ] *(Own-creds only)* Client ID + Secret entered in Lovable → Cloud → Users → Auth → Google.
- [ ] *(Own-creds only)* Authorized redirect URIs include `https://<ref>.supabase.co/auth/v1/callback`
      plus every web domain Lovable lists; Authorized JS origins include `https://cliprename.com`.
- [ ] Electron protocol handler registered (or loopback server implemented).
- [ ] Desktop client uses `@supabase/supabase-js` with `flowType:'pkce'`, opens the system
      browser via `skipBrowserRedirect` + `shell.openExternal`, finishes with
      `exchangeCodeForSession` / `setSession`.
- [ ] Redirect string matches **exactly** everywhere (scheme / host / path / trailing slash).

---

## What we still need to confirm in the live Lovable project

These could not be verified from docs (managed Lovable projects don't appear in the
Supabase Dashboard):

1. **How to surface the Project URL + anon key from a Lovable-managed project.** The values
   live in the generated web client config; there's no confirmed official UI path.
2. **Whether the redirect allowlist (Additional Redirect URLs) is editable for a managed
   project**, and where that UI lives in Lovable.
3. **Whether cliprename.com uses Lovable-managed Google creds or its own** — this decides the
   whole config path (Case A vs Case B above).
4. There is **no official Supabase/Lovable Electron OAuth recipe** — deep-link/loopback
   patterns are community-validated, not blessed docs.

### How to grab the values (when ready)
In the Lovable editor, open the generated Supabase client file (commonly
`src/integrations/supabase/client.ts` or a `.env` with `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY` / publishable key). Copy the **URL** and **anon/publishable key**
verbatim into the desktop app's settings — those exact values bind both apps to the same
accounts.

---

## Key source URLs

- Lovable Google auth (managed vs own creds): https://docs.lovable.dev/features/google-auth
- Lovable ↔ Supabase: https://docs.lovable.dev/integrations/supabase
- Can't access Supabase under Lovable Cloud: https://supabase.com/docs/guides/troubleshooting/cant-access-supabase-project-lovable-cloud
- Supabase Google OAuth (client type, callback URL): https://supabase.com/docs/guides/auth/social-login/auth-google
- PKCE flow: https://supabase.com/docs/guides/auth/sessions/pkce-flow
- Redirect URLs / allowlist: https://supabase.com/docs/guides/auth/redirect-urls
- Native deep linking: https://supabase.com/docs/guides/auth/native-mobile-deep-linking
- signInWithOAuth / skipBrowserRedirect: https://supabase.com/docs/reference/javascript/auth-signinwithoauth
- Electron discussions: https://github.com/orgs/supabase/discussions/17722 · https://github.com/orgs/supabase/discussions/22270
