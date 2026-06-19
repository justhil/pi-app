# ui-settings-composer：设置页重做 + Composer 文件拖拽

父任务：`06-19-ui-polish`（见 `prd.md` §3 + `design.md` §5、§6）。无依赖。

---

## 问题
1. 设置页宽度/元素尺寸/交互逻辑未经打磨。
2. pi 原生设置项不全（model/thinking 只在 composer 会话级，缺全局默认与 thinking steer/compaction/sessionDir 等）。
3. Composer 只有 `onPaste`，**无 `onDrop`/`onDragOver`**，文件拖入功能缺失。

## 范围

### A. 设置页重做（`src/renderer/src/features/settings/settings-page.tsx`）
1. 内容区 `max-width: 720-820px` 居中，避免全宽长行难读。
2. 左侧分组导航 + 右侧内容（参考成熟 agent 设置页）。
3. 元素尺寸规范：行 `py-3`、间距统一、toggle/select/输入框尺寸按 `ui-ux-pro-max` form 条目。
4. 焦点环、对比度、触控尺寸符合 a11y。

### B. pi 原生设置项补充（A 层，写回 `~/.pi/agent/settings.json`）
补充以下全局默认设置项（经 Worker SettingsManager 写回，**不手写 JSON**）：
- 默认模型 / defaultProvider
- thinking steer 模式
- compaction 开关/阈值
- sessionDir
- packages（只读列表 + 说明）
- 已有会话级 model/thinking 保留，这里是**全局默认**

边界：扩展配置仍走兼容层 adapter.json（见 `docs/adapter-layer-plan.md`），不混入。

### C. Composer 文件拖拽整块渲染（`src/renderer/src/features/composer/composer.tsx`）
1. textarea 容器加 `onDragOver`（preventDefault + drop zone 高亮）+ `onDrop`（读 `e.dataTransfer.files`）。
2. 拖入文件 → composer 上方渲染为**整块 chip 列表**（文件名 + 类型图标 + 路径 + 移除 ×），整块视觉。
3. 发送时把 chip 文件路径拼进消息（`@path` 或显式路径）交 Worker/pi 处理；**不在此层读文件内容**（那是 pi 工具职责）。
4. 与现有 `onPaste` 图片逻辑统一：文件粘贴也走同一 chip 渠道。

## 边界
- 设置项只加 pi 官方 settings 字段（spec 硬约束），不借机写扩展私有配置。
- 拖拽只做路径传递，不做文件读取/预览（除非 pi 工具支持）。
- 不动兼容层。

## 验收
1. `npm run build` 绿。
2. 设置页内容居中、元素尺寸统一、焦点环保留、无溢出。
3. 设置含默认模型/thinking steer/compaction/sessionDir，改动写回 settings.json（重启 pi 生效）。
4. 拖文件进 composer → 出现整块 chip（含移除 ×）→ 发送后消息含文件路径。
5. 多文件 chip 可逐个移除；发送后 chip 清空。

## 参考与设计依据

- 父任务 `design.md` §0：参考项目目录（`D:/tmp/pi-ui-refs/{跨端客户端,桌面 Agent UI}`）与文件索引。
- `docs/ui-design-notes.md` §3（侧边栏拖拽）：桌面 Agent UI 的 snap（中点吸附）+ hysteresis（6px 防抖）+ 移动检测三重判定（width<768 或 width<1024 且 hover:none/touch）；跨端客户端 `MIN_CHAT_WIDTH=400` 宽度钳制。
- §4（拖拽）：跨端客户端 FileDropZone 全屏 overlay（backdrop 0.7 + Upload 图标 + 150ms 显隐）+ AttachmentPill chip（缩略图/标签 + 移除 ×）；桌面 Agent UI 拖拽/粘贴统一通道 + 切会话清理。
- 直查源码：`跨端客户端/.../components/file-drop-zone.tsx`、`attachment-pill.tsx`；`桌面 Agent UI/.../layout/Layout.tsx:35-95`、`chat/SendBox/index.tsx`。

## 实现纪律
设置/表单前查 `ui-ux-pro-max` 的 form/touch 条目；组件用 `shadcn-ui` CLI（Collapsible/Tooltip/Chip 等）；先读 `frontend-taste` 定质感方向。
