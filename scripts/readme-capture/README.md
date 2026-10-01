# README capture

Re-shoots every visual used by `README.md` / `README.zh-CN.md` from the real app:

```bash
npm run readme:capture
```

Outputs (overwritten in place):

| File | Content |
|---|---|
| `doc/assets/readme/<lang>/hero-light.png`, `hero-dark.png` | Full window, Review → Git diff open, on a brand gradient |
| `doc/assets/readme/<lang>/timeline.png` | Expanded tool steps of the fix turn |
| `doc/assets/readme/<lang>/panels.png` | Right-sidebar panels side by side (zh: Review/Files/Tree/Run, en: without Tree) |
| `doc/assets/readme/<lang>/agent-turn.gif` | A real worker running the fix turn, replayed at capture speed |
| `doc/assets/readme/<lang>/composer-mention.gif` | `@` file search inserting a reference |
| `doc/assets/readme/social-preview.png` | 1280×640 card for *Settings → Social preview* (upload manually) |

## How it works

1. **Build** — `electron-vite build` into `<work>/app/out` (the repo's `out/` is untouched). The copy's main window gets `webPreferences.offscreen`, and a small entry sets `userData` to the demo directory and never shows windows. Rendering is offscreen, so no display or window manager is involved (Linux uses `--ozone-platform=headless`).
2. **Seed** (`seed.mjs`) — an isolated `HOME` with a small git repo (`~/code/lumen`) and pi sessions written through the SDK's `SessionManager`. Tool results come from running the SDK's real `read` / `edit` / `bash` tools on that repo. Nothing under your own `~/.pi` or app settings is read or written.
3. **Capture** (`capture.mjs`) — Playwright drives the app at 1440×900, device scale 2.
4. **Record** (`record.mjs`) — for the agent GIF a real worker runs the turn against `mock-llm.mjs`, a local OpenAI-compatible endpoint that streams the scripted replies from `demo-script.mjs`; every frame's timestamp is kept so the GIF plays at real speed.
5. **Compose** (`media.mjs`) — ImageMagick frames/crops the PNGs, ffmpeg builds the GIFs, and `social-card.html` is rendered offscreen for the social preview.

The demo story (prompts, thinking, tool calls, final answer) lives in `demo-script.mjs` and is shared by the seeded sessions and the mock endpoint, so screenshots and recording stay consistent.

## Requirements

- `npm install` done; Node.js ≥ 22.19
- `magick` (ImageMagick 7), `ffmpeg` and `git` on `PATH`
- Fonts: the system UI and CJK fonts end up in the images (on Linux: Noto Sans CJK)

## Options

```bash
npm run readme:capture -- --lang en              # one language
npm run readme:capture -- --only screens,social  # subset: screens, agent, composer, social
npm run readme:capture -- --work ./tmp/capture --keep-work --skip-build
```

| Variable | Purpose |
|---|---|
| `PI_CAPTURE_ELECTRON` | Electron binary to use instead of the project's `electron` package |
| `PI_CAPTURE_MOCK_PORT` | Port of the scripted model endpoint (default `18765`) |

## When the UI changes

- Labels the scripts click are in `config.mjs` → `UI`; crop rectangles (logical pixels) are in `CROPS`.
- `app.mjs` injects `offscreen` next to the preload line of the main window in the built bundle; if `src/main/window.ts` changes that line, update `OFFSCREEN_ANCHOR` (the run fails loudly when it is missing).
- A step that cannot find its target logs `step "<name>" failed` and the capture continues — check those shots before committing.
- After a run, review the images and the README text together; the README captions describe what the images show.
