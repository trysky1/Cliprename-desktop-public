# ClipRename Desktop

**AI file sorting and renaming for video editors.** Point ClipRename at a messy
footage folder — it sorts your video, audio, and images, gives every clip a clean,
descriptive AI name, and stages everything drag-and-drop ready for Premiere,
After Effects, or DaVinci Resolve.

Desktop companion to [cliprename.com](https://cliprename.com) — same account,
same plan, same AI credits.

## Download

**[⬇ Get the latest version](https://github.com/trysky1/Cliprename-desktop-public/releases/latest)**

| Your machine | File to download |
|---|---|
| Windows PC | `ClipRename-<version>-setup.exe` |
| Mac — Apple Silicon (M1/M2/M3/M4, 2021+) | `ClipRename-<version>-arm64.dmg` |
| Mac — Intel (pre-2021) | `ClipRename-<version>-x64.dmg` |

### Windows install
Run the `.exe`. If SmartScreen shows "Windows protected your PC", click
**More info → Run anyway** — the app isn't code-signed yet, so Windows can't
verify the publisher.

### macOS install
Open the `.dmg` and drag ClipRename to Applications. The app isn't
Apple-notarized yet, so if macOS says it "is damaged", right-click
**Fix ClipRename.command** inside the `.dmg` → Open → Open.

The app keeps itself up to date: **Settings → Check for updates**.

## What you need

A free [cliprename.com](https://cliprename.com/auth) account — the app signs in
with the same login as the website and uses your plan's AI credits. No API keys.

## How it works & privacy

- To generate names, the app extracts small samples locally (a few video
  keyframes, a downscaled image, or a short audio excerpt) and sends **only
  those samples** — never your full files — to ClipRename's servers for AI
  analysis.
- Your files never leave your machine. **Copy** is the default mode (originals
  untouched), nothing changes on disk until you press **Apply**, and **Undo**
  reverses the last batch.
- [Privacy Policy](https://cliprename.com/privacy) · [Terms](https://cliprename.com/terms)

## Support

- Help & questions: [cliprename.com/support](https://cliprename.com/support)
- Bug reports: [GitHub Issues](https://github.com/trysky1/Cliprename-desktop-public/issues)

## About this repository

This repository hosts the official downloads and release feed for ClipRename
Desktop. The application source code is proprietary and not published — see
[LICENSE](LICENSE).
