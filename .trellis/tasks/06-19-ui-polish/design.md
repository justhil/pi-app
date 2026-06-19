# UI 打磨设计基线

> 本文档是子任务实现的设计依据。调研产物（参考仓库 clone 到系统 temp）不进 git，只把**决策后的 design token 与交互模式**固化在这里。

---

## 0. 参考项目与调研方法（单一来源，子任务都指这里）

### 参考项目目录

```bash
REFS_DIR="D:/tmp/pi-ui-refs"   # Windows；其他平台用 $(node -e 'console.log(require("os").tmpdir())')/pi-ui-refs
```

已 clone 两个成熟 agent 桌面应用到系统临时目录（项目外，零污染，不进 git）：

| 项目 | 路径 | 仓库 | 技术栈 | 可参考 |
|------|------|------|--------|--------|
| 跨端客户端 | `$REFS_DIR/跨端客户端` | github.com/get跨端客户端/跨端客户端 | React Native(expo)+unistyles+reanimated | surface 分层、字体栈、FileDropZone、AttachmentPill、tool-call-details、流式滚动锚定 |
| 桌面 Agent UI | `$REFS_DIR/桌面 Agent UI` | github.com/开源社区/桌面 Agent UI | Electron+React+Arco+UnoCSS | ShimmerText 流式、布局自适应、主题防闪、SendBox 附件生命周期 |

**⚠️ 长线任务注意**：`D:/tmp` 是系统临时目录，跨多天可能被系统清理。若查阅时目录缺失，重新 clone：

```bash
mkdir -p D:/tmp/pi-ui-refs && cd D:/tmp/pi-ui-refs
git clone --depth 1 https://github.com/get跨端客户端/跨端客户端
git clone --depth 1 https://github.com/开源社区/桌面 Agent UI
```

### 调研产出（权威参考文档）

详细研究成果见 **`docs/ui-design-notes.md`**（10 节，含字体/色板/布局/拖拽/流式/工具折叠/防闪/子任务映射/取舍结论）。子任务实现前必读该文档对应章节。

### 关键参考文件索引（查阅时直接定位源码）

| 主题 | 跨端客户端 源码 | 桌面 Agent UI 源码 |
|------|-----------|-------------|
| 字体栈 | `跨端客户端/packages/app/src/styles/theme.ts:492-523` | `桌面 Agent UI/packages/desktop/src/renderer/styles/arco-override.css:1-50` |
| surface 色板 | `跨端客户端/packages/app/src/styles/theme.ts:143-233` | — |
| 侧边栏布局/拖拽 | `跨端客户端/packages/app/src/components/left-sidebar.tsx` | `桌面 Agent UI/.../components/layout/Layout.tsx:35-95` |
| FileDropZone | `跨端客户端/packages/app/src/components/file-drop-zone.tsx` | — |
| AttachmentPill chip | `跨端客户端/packages/app/src/components/attachment-pill.tsx` | — |
| 附件生命周期 | `跨端客户端/packages/app/src/composer/attachments/` | `桌面 Agent UI/.../chat/SendBox/index.tsx` + `useDragUpload`/`usePasteService` |
| ShimmerText 流式 | — | `桌面 Agent UI/.../components/ShimmerText.tsx` |
| 流式滚动锚定 | `跨端客户端/packages/app/src/agent-stream/bottom-anchor-controller.ts` | — |
| 工具结果折叠 | `跨端客户端/packages/app/src/components/tool-call-details.tsx` | — |
| 主题防闪 | — | `桌面 Agent UI/.../renderer/index.html`（内联脚本）|

### 调研纪律

- **只参考设计/模式/token，不复刻代码、不抽逻辑**（跨端客户端 是 RN、桌面 Agent UI 是 Arco，技术栈与 pi-app 不同）。
- 提取后落到本 design.md 与 `docs/ui-design-notes.md`，子任务引用不重复。
- 研究产物作实现依据，不进 git 源码。

---

## 1. 字体系统（ui-fonts）

### 现状
`globals.css` 无 `font-family`，全靠 Tailwind 默认 → Windows 系统雅黑，刺眼。

### 决策（已敲定：系统字体栈）
走系统字体栈，不装 webfont。依据 `docs/ui-design-notes.md` §1：跨端客户端/桌面 Agent UI 两个成熟项目都不装 webfont；桌面 Agent UI 明确禁 Inter（太细）。spec 已同步。

- **UI 字体栈**：`system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif`
- **Mono 字体栈**：`ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace`
- **中文**：显式列在 UI 栈末尾（PingFang SC / Hiragino Sans GB / Microsoft YaHei），不装中文 webfont。
- **代码**：mono 栈，`--font-mono` CSS 变量（可穿透 Shadow DOM，桌面 Agent UI 经验）。
- **落地**：`globals.css` 定义 `--font-sans`/`--font-mono` 变量，`body` 应用 `var(--font-sans)`，`font-mono` utility 用变量。不依赖 CDN/webfont。
- **字号阶梯**：13px 正文（现有）保留，11px 次要，10px 元数据；代码 12px；行高 leading-relaxed。
- **渲染**：`-webkit-font-smoothing: antialiased`（已有）+ `text-rendering: optimizeLegibility`。

### 边界
不装任何 webfont（含 Geist/Inter/IBM Plex）。系统字体栈即权威。

---

## 2. 动效系统（ui-timeline-polish + 全局）

### 现状
仅 fade-in/slide-in，assistant 三圆点 pulse。死板。

### 决策
- **时长**（已有 token，校准）：fast 150ms / normal 240ms / slow 320ms。微交互用 fast，入场用 normal，面板用 slow。
- **曲线**：`cubic-bezier(0.22, 1, 0.36, 1)`（已有，ease-out 工具感）。保留。
- **属性**：只动 `transform` / `opacity`（spec 硬约束，GPU 友好）。
- **新增**：
  - assistant 消息增量入场：新消息块 `slide-in-from-bottom-1`（已有），配合流式平滑。
  - 工具卡展开：`grid-template-rows: 0fr → 1fr` 过渡（纯 CSS 高度动画，GPU 友好）或 Radix Collapsible（项目已装 `@radix-ui/react-collapsible`）。
  - 按钮已有 `active:scale-[0.97]`（composer 发送），推广到主要按钮。
- **禁止**：bounce/elastic、width 动画三栏、全屏 shimmer、装饰渐变。

### 流式效果（ui-timeline-polish）
- assistant token 增量：不闪整块，用「光标条」`border-l` 脉动跟随末尾，或末字 `animate-pulse` 弱化。
- 参考成熟 agent：打字时末尾一个细竖线 caret，淡入淡出；停顿超 800ms 显示「思考中」细文字。
- 关键：平滑，非突变；不阻塞渲染（React 18 自动 batching）。

---

## 3. tool result 淡化可展开（ui-timeline-polish，依赖兼容层）

### 现状
工具结果默认展开占大量空间。

### 决策
- **默认收起**：工具行显示 `工具名 + 状态 + 一行淡化摘要`（text-[10px] muted-foreground），点击展开详情。
- **摘要**：兼容层 `toolCard.statusField` 或首行 truncate。
- **展开**：Radix Collapsible 平滑展开，内容区 `max-h` + overflow-auto。
- **进行中**：spinner + 状态行（兼容层 statusField 抽取）。
- **依赖**：此子任务必须在 adapter-layer-v2 Phase A（工具卡原语）+ Phase B（pi-search 样本）后，否则在 `if(isPiSearchTool)` 硬编码分支上美化是返工。原语就绪后，折叠交互在原语模板层实现，所有插件受益。

---

## 4. 状态记忆（ui-state-memory）

### 现状
`ui-store.ts` 无 persist，全内存。model/thinking 是 runState 被动字段。

### 决策
- **zustand persist**：给 ui-store 加 `persist` 中间件，`localStorage`，`name: 'pi-desktop-ui'`。
- **持久化白名单**（partialize）：侧栏宽、面板宽、主题、model picker 最近选择、thinking picker 最近选择、最近项目、面板开关。**不**持久化：runState（实时态）、timeline messages（session 事实来源在 Worker）。
- **model/thinking 记忆**：
  - picker 选值时，除调 IPC `model.set`，还写 `lastModel` / `lastThinking` 到 store（持久化）。
  - 切会话（loadSession）后，run 事件若带 model/thinking 则用它，**否则回退 lastModel/lastThinking**（不再丢）。
  - 新会话默认用 lastModel，而非每次重选。

### 校准点
确认 Worker `model.set` / `thinkingLevel.set` IPC 对 sessionId='' 的语义（全局 vs 会话级），记忆策略与之对齐。

---

## 5. 设置页重做 + pi 原生设置项（ui-settings-composer）

### 现状
设置页宽度/元素尺寸未经打磨；pi 原生设置项不全。

### 决策
- **布局**：参考成熟 agent 设置页，左侧分组导航 + 右侧内容，内容区 max-width 约 720-820px 居中（现在可能全宽或过窄），避免长行难读。
- **元素尺寸**：用 `ui-ux-pro-max` 的 form/touch 条目；行高 py-3、间距统一；toggle/select 尺寸规范。
- **pi 原生设置项补充**（A 层，写回 `~/.pi/agent/settings.json` 经 Worker）：
  - 默认模型 / defaultProvider
  - thinking steer 模式
  - compaction 开关/阈值
  - sessionDir
  - packages（只读列表 + 说明）
  - 已有 model/thinking 为会话级，这里是全局默认
- **边界**：pi 原生设置走 Worker SettingsManager 写回（spec 硬约束），不手写 JSON；扩展配置仍走兼容层 adapter.json（见 `docs/adapter-layer-plan.md`）。

---

## 6. Composer 文件拖拽整块渲染（ui-settings-composer）

### 现状
仅 onPaste，无 onDrop。

### 决策
- **拖入**：textarea 容器加 `onDragOver`（preventDefault + 高亮 drop zone）+ `onDrop`（读 `e.dataTransfer.files`）。
- **整块 chip 渲染**：拖入的文件渲染为 composer 上方的 chip 列表（文件名 + 类型图标 + 路径 + 移除 ×），整块视觉，非散落文字。参考成熟 agent 的「附件 chip」。
- **发送**：chip 里的文件路径拼进消息文本（`@path` 或显式路径），交 Worker/pi 处理；不在此层做文件内容读取（那是 pi 工具职责）。
- **与粘贴统一**：现有 onPaste 图片逻辑保留；文件粘贴也走同一 chip 渠道。

---

## 7. 不做（范围控制）

- 不改产品范围（保守第一版）。
- 不动兼容层硬编码（timeline-polish 等兼容层）。
- 不做 session tree、多项目、IDE 文件树。
- 不引入重型动画库（framer-motion）除非必要；优先 CSS + Radix。
