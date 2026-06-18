# Quality Guidelines

> pi Desktop 前端代码质量和反 AI slop 规范。

---

## Overview

代码质量不只是 lint 通过，还要避免 AI 生成常见模板感（AI slop）。写完页面/组件后必须过反 slop 自检。

---

## Forbidden Patterns

### 禁止

| 模式 | 原因 |
|------|------|
| Inter 字体 | AI 默认脸，应该用 Geist 或 IBM Plex |
| 紫粉霓虹渐变标题 | AI 设计 cliché |
| 纯 #000 / 纯 #fff | 死黑白，应该用 zinc/slate 中性色 |
| 三等宽卡片横排 | feature row 套路，应该非对称或列表 |
| 每层都套 Card | 应该用分隔线、留白、对齐解决 |
| emoji 当结构图标 | 应该用 lucide SVG |
| loading 只放一个转圈 | 应该骨架屏 |
| 空状态纯空白 | 应该有引导 |
| bounce / elastic 动画 | 工具软件要稳 |
| glassmorphism 大面积 | AI 设计 cliché |
| 装饰性 gradient text | 无意义 |
| 全屏渐变背景 / 粒子 / 光标跟随 | 装饰噪音 |
| 每个工具卡 infinite shimmer | 只在 Run 面板用一条细进度 |
| 侧栏和 Timeline 同时长动画 | 用户会觉得整个应用在晃 |
| 用 width 动画三栏布局 | 拖动即时跟手，松手后 snap |
| Renderer 直接 import Node 模块 | 必须走 IPC |
| Renderer 直接 import pi SDK | 必须走 Worker + AppEvent |
| 删除焦点环 | 无障碍违规 |
| 颜色作为唯一信息传达 | 必须加图标或文字 |

---

## Required Patterns

| 模式 | 要求 |
|------|------|
| 动效只动 transform / opacity | GPU 友好 |
| 缓动用 ease-out 或 cubic-bezier(0.22, 1, 0.36, 1) | 工具感 |
| 动效时长 120-320ms | 短而顺 |
| 尊重 prefers-reduced-motion | 无障碍 |
| 骨架屏 | loading 状态 |
| 空状态引导 | empty 状态 |
| 就近错误显示 | error 状态 |
| 焦点环 2-4px | accessibility |
| 图标按钮 aria-label | accessibility |
| 对比度 4.5:1 | accessibility |
| `cn()` 合并 class | shadcn 标准 |
| CSS 变量做 design token | 不散落 hex |

---

## Skill 调用要求

写前端代码前必须：

1. 读 `frontend-taste` skill（质感方向）。
2. 查 `ui-ux-pro-max` skill 对应条目（accessibility / touch / forms / animation）。
3. 用 `shadcn-ui` skill / CLI 获取组件。

不调用 Skill 就开始写前端代码是违规的。

---

## Testing Requirements

第一版测试策略（和 architecture.md 对齐）：

- 组件单元测试：关键交互组件（ToolCallCard、DiffViewer、TrellisPanel、Composer）。
- IPC 契约测试：AppEvent schema 校验。
- 集成测试：Worker → AppEvent → Renderer 渲染链路。
- 不追求 100% 覆盖率，但核心交互路径必须有测试。

---

## Code Review Checklist

- [ ] 是否调用了 frontend-taste？
- [ ] 是否调用了 ui-ux-pro-max 对应条目？
- [ ] 是否用了 shadcn-ui 而不是手写组件？
- [ ] 动效是否符合规范（时长、缓动、属性）？
- [ ] prefers-reduced-motion 是否降级？
- [ ] 空状态 / loading / error 是否有设计？
- [ ] 焦点环是否保留？
- [ ] 是否有 AI slop（Inter 字体、紫粉渐变、三等宽卡片、emoji 图标）？
- [ ] Renderer 是否直接 import 了 Node 或 pi SDK？
- [ ] AppEvent 是否走 IPC 而非直接消费 SDK 事件？
- [ ] 是否有错误边界（全局 + Timeline 区域 + per-card）？
- [ ] UI 文案是否走 i18n key 而非硬编码？
- [ ] 右键菜单是否只做了第一版范围（复制/路径/重命名/删除）？
- [ ] Git 操作是否只读？

---

## 反 AI slop 自检

写完页面/组件后问一句：

> 换个项目、换个品牌，这个界面是不是照样能用？如果是，说明太通用了。让它带上 pi Desktop 特有的气质再交付。
