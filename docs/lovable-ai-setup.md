# Connect ClipRename to your Lovable AI credits (no key for users)

> **Enable desktop sign-in (1 step — build the handoff page).** The website
> logs in through Lovable's managed OAuth proxy, so the desktop app delegates
> login to the website: it opens `cliprename.com/desktop-auth?port=53682` and a
> tiny page there hands the session back to the app. Paste this prompt into
> Lovable to create that page:
>
> *"Create a new page at /desktop-auth for the ClipRename desktop app. It reads
> an integer `port` query param (1024–65535, default 53682). If the user is not
> signed in, send them through the normal Google sign-in first and return them
> to /desktop-auth with the same port param afterwards. Once a Supabase session
> exists, POST JSON to `http://localhost:PORT/token` with body
> `{ access_token, refresh_token, expires_at, email }` taken from
> supabase.auth.getSession() (email from the session user). On success show
> 'You're signed in — return to the ClipRename app' and nothing else. If the
> POST fails, show 'Open the ClipRename desktop app first, then press Retry'
> with a Retry button that repeats the POST. Never send the tokens anywhere
> except http://localhost:PORT/token."*

Goal: the desktop app uses **your Lovable project's AI balance**, so end users open
the app and it just works — no API key, no setup. Every AI call spends your one
Lovable balance, exactly like your Lovable web app.

How it works: `desktop app → your edge function → Lovable AI → Gemini`. The secret
key lives only in the edge function, never in the app.

---

## What you do (≈10 minutes, one time)

### 1. Turn on Lovable Cloud + AI
In your Lovable project: open **Cloud** (or **Settings → Cloud & AI**) and make sure
**Lovable Cloud** and **Lovable AI** are enabled. This gives every edge function a
secret `LOVABLE_API_KEY` automatically — you don't copy it anywhere.

### 2. Add the function
Add an edge function named **`cliprename-ai`** and paste the code from
`supabase/functions/cliprename-ai/index.ts` (in this repo). In Lovable you can just
tell it: *"Add an edge function called cliprename-ai with this code"* and paste it.
Then **deploy** it.

### 3. Send me two things (both safe to share)
- The function **URL** — looks like
  `https://YOUR-PROJECT.supabase.co/functions/v1/cliprename-ai`
- Your project's **anon key** (Lovable → project/API settings; the *public* anon key,
  not the service key).

> The **anon key is public by design** — fine to ship in the app. ⚠️ Never share the
> **service role** key or the `LOVABLE_API_KEY`; those stay server-side.

### 4. I bake them in
I set those as the app's defaults, so every installed copy uses your AI with zero
user setup. (For testing right now you can also paste them into **Settings →
ClipRename AI** without rebuilding.)

---

## After it's connected — verify (we'll do together)
1. In the app, turn **Practice mode OFF** (no key needed once the URL is set).
2. Suggest names for a folder → real AI names appear.
3. Watch your **Lovable AI balance** tick down — confirms it's on your credits.
4. Try **action naming** on a video → confirms image/vision works through the gateway.

If AI ever returns "out of credit" (HTTP 402), top up in Lovable → Cloud & AI balance.

---

## Step 2 (later): tie it to plans / Stripe
Today every call spends your shared balance with no per-user limit. To make Pro/Free
plans matter and stop strangers draining credits, the app reuses your **website's
Supabase login**: a user who's Pro on cliprename.com is Pro here automatically. The
edge function then checks the signed-in user's plan/quota before calling AI. That's a
separate step — it needs your Supabase auth + the plans table you already use for the
website. Ping me when you want to wire it and share the project.
