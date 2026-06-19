# ui-fonts：字体系统重做

父任务：`06-19-ui-polish`（见 `prd.md` §1 + `design.md` §1）。无依赖，**P0 先做**，全局基础。

---

## 问题
`src/renderer/src/styles/globals.css` 完全没设 `font-family`，全靠 Tailwind 默认 → Windows 系统雅黑，刺眼。

## 方案（已敲定：系统字体栈）

走系统字体栈方案（不装 webfont），依据 `docs/ui-design-notes.md` §1：跨端客户端/桌面 Agent UI 两个成熟项目都不装 webfont；桌面 Agent UI 明确禁 Inter（太细）。省体积、跨平台原生感。

## 范围
1. `globals.css` 定义 `--font-sans` / `--font-mono` 变量，`body` 应用 `font-family: var(--font-sans)`。
2. **UI 字体栈**（spec 硬约束）：
   `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif`
3. **Mono 字体栈**（代码/diff/命令）：
   `ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace`
4. `--font-mono` 用 CSS 变量（可穿透 Shadow DOM，Markdown 渲染用得上，桌面 Agent UI 经验）。
5. `text-rendering: optimizeLegibility` + 保留 `-webkit-font-smoothing: antialiased`。
6. 字号阶梯校准：正文 13px、次要 11px、元数据 10px、代码 12px（与现状对齐，不擅自改尺度）。

## 边界
- 不装任何 webfont（含 Geist/Inter/IBM Plex）。系统字体栈即权威。
- 不改字号尺度（避免连锁调整）。
- 不动兼容层、不动动效（别的子任务）。

## 验收
1. `npm run build` 绿。
2. `globals.css` 含 `--font-sans`/`--font-mono` 变量 + 系统字体栈，`body` 应用 `var(--font-sans)`。
3. 中英文混排清晰、代码用 mono 栈、无刺眼感（前后截图对比）。
4. grep `Geist`/`Inter`/`IBM Plex`/`@fontsource` 在 src 无残留（全面转系统字体栈）。

## 参考与设计依据

- 父任务 `design.md` §0：参考项目目录（`D:/tmp/pi-ui-refs/{跨端客户端,桌面 Agent UI}`）与文件索引。
- `docs/ui-design-notes.md` §1（字体）：**已敲定系统字体栈**。两个成熟项目都不装 webfont；桌面 Agent UI 明确禁 Inter（太细）。UI 栈与 mono 栈见「方案」段。
- 直查源码：`跨端客户端/packages/app/src/styles/theme.ts:492-523`（DEFAULT_UI/MONO_FONT_STACK）、`桌面 Agent UI/.../styles/arco-override.css:1-50`（含禁 Inter 理由 + --font-mono CSS 变量穿透 Shadow DOM）。
- 技术栈差异：跨端客户端 是 RN、桌面 Agent UI 是 Arco，只取 token 与模式。

## 实现纪律
先读 `frontend-taste` skill 定字体方向；按 `.trellis/spec/frontend/quality-guidelines.md`（禁止 Inter，用系统字体栈）。
