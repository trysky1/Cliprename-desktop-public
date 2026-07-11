---
name: run-desktop
description: Build, run, and drive the ClipRename Electron app headless. Use when asked to start the desktop app, take a screenshot of it, or interact with its UI on a machine without a display.
---

ClipRename is an Electron app. On headless Linux, drive it via the Playwright
REPL at `.claude/skills/run-desktop/driver.mjs` under xvfb. Launch takes ~6s;
the single window is `out/renderer/index.html`.

## Prerequisites

`xvfb` plus the usual Chromium shared libs (`libnss3 libgbm1 libasound2t64
libgtk-3-0`) — all preinstalled on the standard remote container. The driver
needs `playwright-core`: `npm install --no-save playwright-core`.

## Build

```bash
npm install
npx electron-vite build   # outputs out/main, out/preload, out/renderer
```

(`npm run build` also runs electron-builder — unnecessary for driving the app.)

## Run

```bash
tmux new-session -d -s app -x 200 -y 50
tmux send-keys -t app 'xvfb-run -a node .claude/skills/run-desktop/driver.mjs' Enter
timeout 30 bash -c 'until tmux capture-pane -t app -p | grep -q "cliprename driver"; do sleep 0.3; done'
tmux send-keys -t app 'launch' Enter
timeout 90 bash -c 'until tmux capture-pane -t app -p | grep -q "launched\."; do sleep 0.5; done'
tmux send-keys -t app 'ss landing' Enter
```

Screenshots land in `/tmp/shots/` (override: `SCREENSHOT_DIR`).

### Commands

| command | what it does |
|---|---|
| `launch` | launch the app, wait for the window |
| `ss [name]` | screenshot → `/tmp/shots/<name>.png` |
| `click <css-sel>` | click element via DOM `.click()` |
| `click-text <text>` | click button/link containing text |
| `type <text>` / `press <key>` | keyboard input |
| `wait <css-sel>` | wait for element, 10s timeout |
| `eval <js>` | evaluate in the renderer, print JSON |
| `text [css-sel]` | print innerText |
| `stub-picker <dir>` | stub the native folder dialog to return `<dir>` |
| `windows` | list windows |
| `quit` | close app, exit |

## Gotchas

- **Button labels are CSS-uppercased** — `click-text` matches the DOM text
  ("Suggest names for 3 files"), not the rendered "SUGGEST NAMES FOR 3 FILES".
- **Native folder dialog can't open headless** — run `stub-picker /path` first,
  then click "Add a folder"; the real scan flow runs from there.
- **First launch shows a Welcome modal** — dismiss with
  `eval`-clicking the button matching /show me the app/i.
- **Practice Mode is the default** — rename suggestions work without a Gemini
  key; live AI, cloud sign-in, and plan display need real credentials.
- **The preload API is `window.api`** — `scanPaths`, `suggest`, `apply`,
  `stageClip`, etc., if you need to bypass the UI.
- Don't `pkill -f electron` to clean up — it kills the harness too. Use the
  driver's `quit` or `tmux kill-session -t app`.
