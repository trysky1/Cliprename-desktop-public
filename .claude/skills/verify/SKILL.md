---
name: verify
description: Build the app, run it, take a preview screenshot, and confirm the core happy-path works. Use before reporting a feature or fix as done. Reports any unverified external dependencies (auth, asset bundles).
---

# Verify

Build the app, run it, take a preview screenshot, and confirm the core happy-path
works. Report any unverified external dependencies (auth, asset bundles).

## Steps

1. **Build** — `npm run build` (electron-vite build). Fail fast if the build errors;
   surface the first error rather than continuing.
2. **Run** — launch the app (`npm run dev` for the dev window, or the packaged exe in
   `release/` when verifying a build). Confirm the window opens with no console errors.
3. **Screenshot** — capture a preview screenshot of the running app so the rendered
   UI is verified, not just the code.
4. **Happy-path** — exercise the core flow end-to-end: add a source folder → scan →
   categorize → AI/sandbox rename → preview → stage a clip to the tray → drag-out
   target exists at full quality.
5. **Report** — give a checklist of every feature touched:
   - **Verified working end-to-end**
   - **Untested / unverified**
   - **Depends on external config** (Gemini API key, cliprename.com auth/Supabase,
     Stripe, asset bundles) — flag these explicitly; never report them as "working"
     unless actually exercised against real credentials.

## Notes

- I cannot drive the Electron GUI directly. For interactive behaviors (playback,
  scrubbing, native drag-out), verify via clean build + clean launch + headless
  ffmpeg/algorithm checks, then ask the user to confirm the interactive step.
- Do not declare login or any external-service feature "done" until its credentials
  are confirmed configured and the flow has actually been run.
