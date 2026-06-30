# Getting started

**[简体中文](./getting-started.zh-CN.md)**

Hands-on guide for first-time **pi Desktop** users. Screenshots: [../images/](../images/) (replace placeholder with `overview.png` when publishing).

---

## 1. Install & run

```bash
git clone https://github.com/justhil/pi-app.git
cd pi-app
npm install
npm run dev
```

**Prerequisites**: working CLI pi auth (`~/.pi/agent/auth.json` or provider env vars). Sessions and `settings.json` are shared with terminal pi.

**Windows installer (build locally)**: `npm run icon:export && npm run package:win` → `dist/`

**Prebuilt**: [GitHub Releases](https://github.com/justhil/pi-app/releases/latest) — Setup and Portable `.exe`.

---

## 2. First session (5 steps)

1. **Disk project** — left sidebar, open a folder (Agent tool cwd).
2. **Or sandbox** — “chat partitions”, isolated cwd under app user data.
3. **Session** — pick history or `+` new; right-click rename/delete on disk projects.
4. **Composer** — `Enter` send; `/` slash commands; drag files or `+`; `Ctrl+V` images; **KaTeX** in messages.
5. **Right panel** — review, run, context, **session tree**, **Files** (tabbed preview, tree, expand preview into chat column); empty composer + **double `Esc`** opens tree overlay.

---

## 3. Daily use

| Action | How |
|--------|-----|
| Newline | `Shift+Enter` |
| Send history | `↑` / `↓` when composer empty and caret at top |
| Pull queued message | `Alt+↑` while agent running |
| Stop generation | `Esc` |
| Queue follow-up | Send while running; runs after current turn |
| Jump to node | Hover message → Undo, or session tree |
| Model / thinking | Composer bottom pills |
| Language | **Settings → General** → 中文 / English |
| Voice | Composer mic; **Settings → Voice** for codex-asr |
| Attach (file tree) | Right panel **Files** → **drag a file** onto the composer (folders cannot be dragged); or right-click → **Add to chat** |
| Multi-tab preview | **Files** tree: `Ctrl`/`⌘`+click, or right-click → **Open in new tab**; middle-click closes; drag tabs to reorder |
| Wide preview | **Files** toolbar **Expand preview** (fills chat column; inner file tree collapse unchanged) |
| Attach (other) | Drag from Explorer into composer, `+` picker, `Ctrl+V` for images |

Full shortcut table: [README.md](../../README.md#keyboard-shortcuts).

---

## 4. Extensions

1. Terminal: `pi install npm:<package>` or `pi install git:github.com/...`
2. Ensure `packages` in `~/.pi/agent/settings.json`.
3. Desktop **Settings → Extensions** — check tools for **current session**.
4. Missing tools: **restart worker session** (new session or reopen project).
5. Dialog extensions open automatically; config under **Settings → Desktop adapters**.

Lists: [adapters.en.md](./adapters.en.md). Authoring: [adapter-authoring-guide.md](../adapter-authoring-guide.md).

---

## 5. Troubleshooting

| Issue | Try |
|-------|-----|
| Blank UI / stale HMR | Remove `node_modules/.vite`, `npm run dev` |
| Extension in settings, no tools | Check `packages`, **restart session** |
| Slow session switch | Recent tail first; full bind on send/tree jump |
| Voice not working | Settings → Voice; text input still works |
| Dialog dismissed | Timeline **Continue** or clear “answer later” |

Community: [LinuxDo](https://linux.do/)