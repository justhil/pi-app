# ui-timeline-polish：tool result 淡化可展开 + 流式 + 动效

父任务：`06-19-ui-polish`（见 `prd.md` §3 + `design.md` §2、§3）。

---

## ⚠️ 依赖（硬约束）

**必须在 `adapter-layer-v2` Phase A（工具卡原语骨架）+ Phase B（pi-search 样本）完成后开工。**

原因：当前 Timeline 工具卡渲染是 `if(isPiSearchTool)` / `if(image_gen)` 硬编码分支（见 `src/renderer/src/features/timeline/timeline.tsx`）。在这上面做"淡化可展开"美化是返工——兼容层会把它重构成原语查表。等原语就绪后，折叠/流式/动效在**原语模板层**实现，所有插件一次受益。

开工前确认：`adapter.json` 的 `toolCard.template` + `statusField` 已落地，`timeline.tsx` 已改为查表（无插件名 if 分支）。

---

## 问题
1. tool result 默认展开占大量空间，无淡化折叠。
2. assistant 流式出字无打字感、突变。
3. 动效只有 fade/slide，死板。

## 范围

### A. tool result 淡化可展开
1. 工具行默认显示：`工具名 + 状态 + 一行淡化摘要`（`text-[10px] text-muted-foreground`），点击展开详情。
2. 摘要来源：兼容层 `toolCard.statusField` 或首行 truncate（`max-w-[200px] truncate`）。
3. 展开：Radix Collapsible（项目已装 `@radix-ui/react-collapsible`）平滑展开，内容区 `max-h` + `overflow-auto`。
4. 进行中：spinner + 状态行（兼容层 statusField 抽取）。
5. **在原语模板层实现**（default/list/media/tree/kv），不写插件名分支。

### B. 流式打字效果
1. assistant token 增量平滑：末尾细竖线 caret，淡入淡出脉冲；不闪整块。
2. 停顿超 800ms 显示「思考中」细文字。
3. 平滑非突变，利用 React 18 自动 batching，不阻塞渲染。

### C. 整体动效美化
1. 入场：消息块 `slide-in-from-bottom-1`（已有，校准时长）。
2. 微交互：主按钮 `active:scale-[0.97]`（composer 已有，推广）。
3. 只动 `transform`/`opacity`（spec 硬约束），`prefers-reduced-motion` 降级。
4. 禁止 bounce/elastic、width 动画三栏、全屏 shimmer、装饰渐变。

## 边界
- 不动兼容层硬编码（等它先重构）。
- 不引入重型动画库（framer-motion）除非必要；优先 CSS + Radix。
- 不改字号尺度（ui-fonts 已定）。

## 验收
1. `npm run build` 绿。
2. tool result 默认单行淡化，点击展开详情，空间显著降低。
3. assistant 出字有自然增量过渡（caret），停顿有「思考中」。
4. 动效流畅不卡顿，`prefers-reduced-motion` 降级生效。
5. Timeline 无 `if(isPiSearchTool)` 等插件名分支（兼容层 v2 边界），折叠在原语层。

## 参考与设计依据

- 父任务 `design.md` §0：参考项目目录（`D:/tmp/pi-ui-refs/{跨端客户端,桌面 Agent UI}`）与文件索引。
- `docs/ui-design-notes.md` §5（流式）：桌面 Agent UI ShimmerText（gradient+background-clip:text 扫描，比三圆点 pulse 细腻，局部 shimmer 不违反 spec「禁全屏 shimmer」）；跨端客户端 `bottom-anchor-controller.ts` 流式滚动锚定（用户上滑解锚、回到底部跟随）。
- §6（工具折叠）：跨端客户端 `tool-call-details.tsx` 摘要行（`[工具名] 摘要`）+ 折叠详情 + 工具名人类可读化（`read_file→Read File`）。
- 直查源码：`桌面 Agent UI/.../components/ShimmerText.tsx`；`跨端客户端/.../agent-stream/bottom-anchor-controller.ts`、`components/tool-call-details.tsx`。

## 实现纪律
查 `ui-ux-pro-max` 的 animation 条目；Collapsible 用 shadcn/Radix；先读 `frontend-taste` 定流式质感方向。
