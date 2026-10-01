# README capture

Re-shoots every visual used by `README.md` / `README.zh-CN.md`:

```bash
npm run readme:capture
```

Screenshots and GIFs come from the real app; the overview, architecture and theme visuals are HTML pages under `renders/` composed from those screenshots and rendered offscreen. All outputs are overwritten in place:

| Step (`--only`) | Output in `doc/assets/readme/<lang>/` | What it shows |
|---|---|---|
| `screens` | `hero-light.png`, `hero-dark.png`, `timeline.png`, `panels.png` | Framed window with the Git diff, expanded tool steps, right-sidebar panels |
| `agent` | `agent-turn.gif` | A real worker running the fix turn, replayed at capture speed |
| `composer` | `composer-mention.gif` | `@` file search inserting a reference |
| `review` | `review-stage.gif` | Widening the sidebar, side-by-side diff, staging a hunk |
| `files` | `files-preview.gif` | Preview tabs, quoting a line into the composer, expanded preview |
| `parallel` | `parallel-sessions.gif` | Two sessions running at once while switching between them |
| `visuals` | `overview.png`, `architecture-{light,dark}.png`, `theme-switch.gif` | Rendered from `renders/*.html`; needs `screens` and `parallel` from the same run |
| `social` | `doc/assets/readme/social-preview.png` | 1280×640 card for *Settings → Social preview* (upload manually) |

## How it works

1. **Build** — `electron-vite build` into `<work>/app/out` (the repo's `out/` is untouched). The copy's main window gets `webPreferences.offscreen`, and a small entry sets `userData` to the demo directory and never shows windows. Nothing needs a display or window manager (Linux uses `--ozone-platform=headless`).
2. **Seed** (`seed.mjs`) — an isolated `HOME` with a small git repo (`~/code/lumen`) and pi sessions written through the SDK's `SessionManager`. Tool results come from running the SDK's real `read` / `edit` / `bash` tools on that repo. Your own `~/.pi` and app settings are never read or written.
3. **Capture** (`capture.mjs`) — Playwright drives the app at 1440×900, device scale 2.
4. **Record** (`record.mjs`) — frames with timestamps, so GIFs replay at real speed. The agent and parallel recordings run real workers against `mock-llm.mjs`, a local OpenAI-compatible endpoint that streams the scripted turns from `demo-script.mjs` (it picks the script from the first user message).
5. **Render** (`render.mjs`, `visuals.mjs`, `renders/`) — each template reads `window.__DATA__` (copy, crops of the screenshots, adapter names from `src/extension-compat/builtin`, the version from `package.json`) and is captured in one offscreen Electron run. Animated templates expose `window.renderFrame(t)`.
6. **Compose** (`media.mjs`) — ImageMagick frames and crops PNGs, ffmpeg builds GIFs.

The demo story (prompts, thinking, tool calls, answers) lives in `demo-script.mjs` and is shared by the seeded sessions and the mock endpoint, so stills and recordings tell the same story.

## Requirements

- `npm install` done; Node.js ≥ 22.19
- `magick` (ImageMagick 7), `ffmpeg` and `git` on `PATH`
- Fonts: the system UI and CJK fonts end up in the images (on Linux: Noto Sans CJK)

## Options

```bash
npm run readme:capture -- --lang en                     # one language
npm run readme:capture -- --only review,files           # some steps
npm run readme:capture -- --only screens,parallel,visuals
npm run readme:capture -- --work ./tmp/capture --keep-work --skip-build
```

| Variable | Purpose |
|---|---|
| `PI_CAPTURE_ELECTRON` | Electron binary to use instead of the project's `electron` package |
| `PI_CAPTURE_MOCK_PORT` | Port of the scripted model endpoint (default `18765`) |

## When the UI changes

- Labels the scripts click are in `config.mjs` (`UI`) and in `record.mjs` (aria labels of the Review / Files buttons, both languages); crop rectangles in logical pixels are in `CROPS`, `SPLITTER` and `visuals.mjs`.
- `app.mjs` injects `offscreen` next to the preload line of the main window in the built bundle; if `src/main/window.ts` changes that line, update `OFFSCREEN_ANCHOR` (the run fails loudly when it is missing).
- Screenshot steps that cannot find a target log `step "<name>" failed` and continue; recordings stop with an error. Check the output before committing.
- Rendered copy lives in `visuals.mjs` (`COPY`), next to the README text it has to agree with.
