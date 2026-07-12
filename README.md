# ClipRename Desktop

AI file sorting and renaming for video editors. Point ClipRename at a local editing
folder and it sorts your video, audio, and images, gives every clip a clean
AI-suggested name, and stages the results drag-and-drop ready for your NLE
(Premiere, After Effects, DaVinci Resolve). It's the desktop companion to
[cliprename.com](https://cliprename.com) — same account, same plan, same AI credits.

## Download

Get the latest installer from the
[releases page](https://github.com/trysky1/Cliprename-desktop-public/releases/latest):

| Your machine | Download |
|---|---|
| Windows PC | `ClipRename-<version>-setup.exe` |
| Mac with Apple Silicon (M1/M2/M3/M4) | `ClipRename-<version>-arm64.dmg` |
| Mac with Intel | `ClipRename-<version>-x64.dmg` |

The app updates itself: once installed, use **Settings → Check for updates** to get
new versions.

### Windows install

Run the `.exe`. SmartScreen may show "Windows protected your PC" — the build isn't
code-signed yet, so Windows can't verify the publisher. Click **More info → Run
anyway** and follow the installer.

### macOS install

Open the `.dmg` and drag ClipRename to Applications. Because the build isn't
Apple-notarized yet, macOS may claim the app "is damaged" — it isn't. Right-click
**Fix ClipRename.command** in the `.dmg` window and choose **Open** to clear the
block, or follow the `HOW TO INSTALL` text file that ships next to the download.

## What you need

A free [cliprename.com](https://cliprename.com) account. The app is behind a
sign-in gate and uses your account's AI credits — there are no API keys to manage.

## How it works & privacy

- **Your files never leave your machine.** ClipRename extracts small samples
  locally with bundled ffmpeg — a few video keyframes, a downscaled image, or a
  short audio excerpt — and sends only those samples to cliprename.com's servers
  for AI analysis.
- **Copy is the default.** Originals stay untouched; toggle Move if you want it.
- **Nothing changes until you press Apply**, and **Undo** reverses the last batch.

See the [privacy policy](https://cliprename.com/privacy) and
[terms of service](https://cliprename.com/terms).

## Support

- Help center: [cliprename.com/support](https://cliprename.com/support)
- Bugs and feature requests:
  [GitHub Issues](https://github.com/trysky1/Cliprename-desktop-public/issues)

## Building from source

Requires Node 22+.

```bash
npm install
npm run dev          # run the app with hot reload
npm run build:win    # Windows installer  → release/
npm run build:mac    # macOS dmg + zip    → release/ (build on a Mac)
```

CI (GitHub Actions) builds and publishes releases automatically on `v*` tags.

## License

Source-available, proprietary. See [LICENSE](LICENSE) — you may read the code and
build it for personal, non-commercial use; official builds are distributed only via
the [releases page](https://github.com/trysky1/Cliprename-desktop-public/releases)
and [cliprename.com](https://cliprename.com).
