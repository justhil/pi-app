# pi Desktop extension adapter docs (for AI / extension authors)

**[简体中文](./README.zh-CN.md)**

Standalone docs for **pi Desktop compatibility layer v2**. Copy to any AI to author **`adapter.json`** for **pi npm extensions** without reading the whole pi-app tree.

## User guide (install, shortcuts, adapter list)

| Path | Purpose |
|------|---------|
| [guide/getting-started.md](./guide/getting-started.md) · [zh-CN](./guide/getting-started.zh-CN.md) | First-run walkthrough |
| [guide/adapters.en.md](./guide/adapters.en.md) · [zh-CN](./guide/adapters.zh-CN.md) | Builtin adapters (run `npm run docs:adapters`) |
| [images/](./images/) | README screenshots |

Internal design, audits, and architecture-skill playbook: local `docs/` (see `docs/README.md`). Skill invocation rules: `docs/dev/architecture-tooling.md` (local) · pointer for clones: [dev/architecture-tooling.md](./dev/architecture-tooling.md).

## Adapter authoring (AI / extension authors)

| File | Purpose |
|------|---------|
| **[adapter-authoring-guide.md](./adapter-authoring-guide.md)** | **Main guide**: adapter from scratch, §1 external override, config / toolCard / dialogs / slash / side panel, IPC, examples, checklist |
| [adapter-layer-plan.md](./adapter-layer-plan.md) | Architecture: A/B/C layers, merge rules, primitives, **workspace-trellis / workspace-tasks**, constraints |

## Prompt for AI (paste as-is)

```text
You are a pi Desktop extension adapter author. Use only doc/adapter-authoring-guide.md (and doc/adapter-layer-plan.md if needed).

Task: write or update adapter.json for npm extension "<package>".
Known: <registerTool names, registerCommand, config paths, ctx.ui flows>.

Rules:
1. match.names must match the extension package name; pick tier by desktop capability.
2. External JSON in ~/.pi/desktop/adapters/ or .pi/desktop/adapters/ replaces builtin by match.names (full replace, not deep merge) — see guide §1.
3. Dialogs use generic Extension UI; complex params via interact + toolCard — see §8.
4. Do not assume pi-desktop adds plugin-specific IPC or if (pluginId) branches.
5. Side panel uses registered keys (workspace-trellis + workspace-tasks) — see §10.
6. Output full JSON + install path + verification steps.

If info is missing, list what to confirm from extension README/source first.
```

## Relation to the app

- **Builtin** adapters: `src/extension-compat/builtin/*.adapter.json` in pi-app.
- Schema source of truth: `adapter-schema.ts` if docs disagree.
- User/project JSON can override builtin **without an app release** (by package name) — guide **§1**; cache/refresh — **adapter-layer-plan.md §2.1–§2.2**.

## Where to get it

- Same repo as [pi-app](https://github.com/justhil/pi-app), path **`doc/`**.
- Browse on GitHub: `doc/adapter-authoring-guide.md`.

---

*pi Desktop — pi core, desktop shell, declarative adapters.*