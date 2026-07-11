# ClipRename Desktop

Point it at a local editing folder → it sorts **video / audio / images**, gives them clean
AI-suggested names, and lays everything out **drag-and-drop ready for your NLE**. Companion to
[cliprename.com](https://cliprename.com).

## Quick start

```bash
npm install
npm run dev        # launches the Electron app with hot reload
```

The app opens in **Sandbox mode** by default — it fakes AI names so you can test the whole flow
(scan → preview → apply → undo) with **no API key and no login**.

## Real AI naming (optional, cheap)

1. Get a free **Gemini** key at https://aistudio.google.com/app/apikey
2. Settings ⚙ → paste the key → turn **Sandbox** off (Live AI).
3. Click **Analyze with AI**. Video keyframes / images / short audio clips are extracted locally
   with bundled ffmpeg and sent to Gemini Flash (pennies at scale).

## AI Chat Sorting

The right-hand panel: describe how you want files sorted in plain English. The AI proposes a
folder plan (with alternatives), applies it on approval, and tells you when a request isn't
possible. Requires Live AI (a Gemini key).

## Safety

- **Copy** mode by default (originals untouched). Toggle **Move** in the preview.
- Nothing changes until you press **Apply** in the preview.
- **Undo last** reverses the most recent batch. Never overwrites — duplicates get `-1`, `-2`…

## Download a build (Windows & macOS)

Separate installers are produced for each platform — grab the one for your machine:

| Your machine | File | Artifact |
|---|---|---|
| **Windows PC** | `ClipRename-<version>-setup.exe` | `ClipRename-Windows` |
| **Mac with Apple Silicon** (M1/M2/M3/M4) | `ClipRename-<version>-arm64.dmg` | `ClipRename-macOS-AppleSilicon` |

The installers are built by GitHub Actions. Go to the repo's **Actions** tab → the
latest **Build installers** run → download the artifact for your platform. You can
start a build yourself from that tab via **Run workflow**, or by pushing a `v*` tag.

> **Intel Macs:** CI builds Apple Silicon only (every MacBook since late 2020 is
> Apple Silicon, and Intel runners are scarce). To produce an Intel `.dmg`, add a
> `macos-13` entry to the matrix in `.github/workflows/build.yml`, or build it on an
> Intel Mac with `npm run build:mac:x64`.

### First launch on macOS (unsigned build)

The Mac build isn't notarized with an Apple Developer certificate yet, so Gatekeeper
blocks it the first time. Open it once with either:

- **Right-click** the app → **Open** → **Open** in the dialog, **or**
- in Terminal: `xattr -cr /Applications/ClipRename.app` then open it normally.

After that it launches like any other app.

## Build the installers yourself

Each platform must be built **on that platform** (the bundled ffmpeg is
CPU-specific, and only macOS can produce a `.dmg`):

```bash
npm run build:win        # Windows  → release/ClipRename-<version>-setup.exe
npm run build:mac        # macOS, current CPU → release/*.dmg + *.zip
npm run build:mac:arm64  # macOS, force Apple Silicon
npm run build:mac:x64    # macOS, force Intel
```

## Roadmap — connect to cliprename.com

Shared Google login, usage quota, and the same Stripe billing (via the existing site). Needs the
site's Supabase URL + anon key and the billing page URL. Until then the app runs in local mode.
