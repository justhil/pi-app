# Component Guidelines

> pi Desktop 组件模式、shadcn 使用、无障碍、动效约束。

---

## Overview

组件基于 shadcn/ui（new-york + zinc），Radix 无障碍底座。气质偏工具型 Agent 工作台，不是营销站。

---

## Component Structure

### 分层规则

| 层 | 放什么 | 禁止 |
|----|--------|------|
| `components/ui/` | shadcn CLI 生成/微调的原始组件 | 写业务逻辑 |
| `components/app/` | 可复用业务组合件 | 放 shadcn 原始组件 |
| `features/*/` | 功能页面/面板 + 局部 hook + IPC 调用 | 放 shadcn 原始组件 |

### 标准组件文件结构

```tsx
// 1. imports
// 2. types / props interface
// 3. component
// 4. export
```

---

## Props Conventions

- Props 用 TypeScript interface，不用 inline type。
- 复杂 props 拆到同目录 `types.ts`。
- 不用 `any`；不确定的 union 用 `as const` + 字面量类型。

---

## Styling Patterns

### 技术栈

- Tailwind CSS 3+
- 设计 token 用 CSS 变量（在 `styles/globals.css` 定义）。
- 组件内用 `cn()` 合并 class（shadcn 标准）。

### 色彩约束

- 基底：zinc/slate 中性色，略偏冷。
- 强调色：单一 accent，只用于主按钮、运行中、链接、选中会话。
- 禁止：紫粉霓虹渐变标题、glassmorphism 大面积、纯 #000 / 纯 #fff。

### 排版约束

- 正文 14-15px，行高 1.5。
- 标题靠字重 + 颜色，不靠巨大字号。
- Timeline 里代码/路径/命令：mono + 略小一号。
- 字体：Geist Sans + Geist Mono（或 IBM Plex Sans + Plex Mono）。禁止 Inter 当默认。

### 圆角

- 统一 `rounded-lg` 级，不要大圆角气泡聊天风。

---

## shadcn 组件清单（第一版）

首批安装：

```
button input textarea label
dialog alert-dialog sheet
tabs scroll-area separator badge tooltip
dropdown-menu select switch checkbox
skeleton sonner collapsible resizable
```

第一版不做：复杂 Chart 库、Carousel、Marketing Hero。

---

## Accessibility

### 必须遵守

- 焦点环不删除（2-4px）。
- 图标按钮必须有 `aria-label`。
- Tab 顺序匹配视觉顺序。
- 颜色不作为唯一信息传达方式（加图标或文字）。
- 对比度 4.5:1（正文）/ 3:1（大字）。
- 尊重 `prefers-reduced-motion`。

### 查规则

做表单/导航/无障碍前，必须查 `ui-ux-pro-max` skill 的 accessibility / touch / forms 条目。

---

## 动效约束

### 定调

默认体验：Agent 桌面 级丝滑。侧栏、右栏 Tab、面板切换、卡片入场用短 ease-out 的 transform/opacity。系统开启「减少动态效果」时，保留布局与状态，关闭位移与 stagger。

### 原则

- 动效服务空间连续性，不是装饰噪音。
- 只动 transform / opacity；少动 width / height。
- 界面级 200-320ms；微交互 120-180ms。
- 缓动：ease-out 或 cubic-bezier(0.22, 1, 0.36, 1)。
- 禁止 bounce / elastic。
- prefers-reduced-motion 时位移/stagger 关掉。

### Motion Token

```css
:root {
  --motion-fast: 150ms;
  --motion-normal: 240ms;
  --motion-slow: 320ms;
  --motion-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-fast: 0ms;
    --motion-normal: 0ms;
    --motion-slow: 0ms;
  }
}
```

### 具体场景

| 场景 | 动效 |
|------|------|
| 侧栏收起/展开 | translateX + opacity，200-320ms |
| 右栏 Tab 切换 | cross-fade 180-220ms + 指示条滑动 |
| Timeline 新卡片 | fade + translateY(4-8px)，200ms，stagger 前 5 条 30-40ms |
| 工具卡展开/折叠 | CSS grid 0fr→1fr 或 Radix Collapsible |
| Composer 聚焦 | 边框/ring 150ms |
| 发送→Stop | 按钮状态切换 150ms |
| Settings Dialog | ~200ms |
| Ask Modal | 240ms 入场，180ms 退出 |
| Toast | 滑入 200ms |
| 图片 Preview | scale + fade |

### 禁止的动效

- 全屏渐变背景、粒子、光标跟随。
- 每个工具卡 infinite shimmer。
- 侧栏和 Timeline 同时长动画。
- 用 width 动画三栏布局（拖动即时跟手，松手后 snap）。

---

## 架构绑定的 UI 规则

| 场景 | UI 形态 |
|------|---------|
| Ask 必答 | Modal / Dialog（shadcn Dialog） |
| Ask / 工具过程 | Timeline Card |
| 长任务状态 | Run 面板（右栏 Run tab） |
| 图片生成/审查 | Timeline Card + 大图 Preview（Dialog） |
| Trellis | 右栏 Trellis tab，列表 + 阶段标签，只读 |
| Extension 配置 | Settings → Extensions → JSON Schema Form |
| 危险/未兼容插件 | Alert + 二次确认（alert-dialog） |
| Compaction | Timeline 分隔标记"已压缩 N 条"，可展开摘要 |
| 斜杠命令补全 | Composer 内 popover，数据走 IPC commands.list |
| 图片粘贴/拖拽 | Composer 支持 Ctrl+V 粘贴、拖拽到窗口 |
| 右键菜单 | Timeline（复制消息）、Review（复制路径、打开文件）、会话（重命名、删除） |

### Compaction UI

Timeline 在 compaction 处显示分隔标记：

```text
┌─ 已压缩 42 条历史 ──────────────────────┐
│  摘要：用户讨论了认证模块重构方案…         │
│  [展开查看完整摘要]                       │
└──────────────────────────────────────────┘
```

### 斜杠命令补全

- 输入 `/` 触发补全弹窗。
- 数据来源走 IPC `commands.list`（合并 pi skills + prompts + extension commands）。
- 选中后插入或直接执行。
- 用 shadcn Command 组件或自定义 popover。

### 图片输入

- Composer 支持 Ctrl+V 粘贴图片。
- 支持拖拽图片到窗口。
- 通过 `prompt.sendWithImages` IPC 发送。

### 右键菜单

第一版最小右键菜单：

| 区域 | 菜单项 |
|------|--------|
| Timeline 消息 | 复制 |
| Review 文件 | 复制路径、打开文件 |
| 会话列表 | 重命名、删除 |

不做：fork from here、批量操作。

### Git 只读

Review 面板只读 git：
- 只做 `git diff` / `git status` / `git log` 读取。
- 不做 commit / stash / checkout / push。
- 不提供 git 写按钮。

---

## Common Mistakes

- 每层都套 Card（应该用分隔线、留白、对齐解决）。
- 用 emoji 当结构图标（应该用 lucide SVG）。
- loading 只放一个转圈（应该骨架屏）。
- 空状态纯空白（应该有引导）。
- 所有动画 bounce/elastic（应该 ease-out）。
- 用 Inter 字体（应该用 Geist 或 IBM Plex）。
