# 品牌资源与窗口 Chrome

> 图标、favicon、Electron 窗口图标、顶栏品牌标。

---

## 1. 文件与流水线

| 路径 | 作用 |
|------|------|
| `resources/icon.svg` | **主源**（用户可手改） |
| `src/renderer/public/icon.svg` | 与主源同步 → dev favicon |
| `src/renderer/src/components/brand/pi-mark.tsx` | 顶栏内联 SVG，与主源视觉一致 |
| `build/icon.png` | `npm run icon:export`（sharp 从 SVG 导出 1024） |
| `electron-builder.yml` | Win 图标 `build/icon.png`；`package:win` 先跑 `icon:export` |

用户替换 `resources/icon.svg` 后须：**同步 public + PiMark 文案/路径（若结构变）+ icon:export**。

---

## 2. PiMark 使用

- 仅 **品牌识别**（ImmersiveChrome 等），**不是**助手头像（助手侧 **无 Bot 图标**）
- 尺寸默认 14–16px；`rounded-[3px]` 可选
- 若 SVG 用 `<text>π</text>`，PiMark 用相同 font-family（Times/Georgia 栈）与 viewBox

---

## 3. Electron

- `window.ts`：`resolveWindowIcon()` 读 `build/icon.png` 或 `resources/icon.png`
- `index.html`：`<link rel="icon" href="/icon.svg">`

---

## 4. 用户品牌意图（记录）

- 黑白、强设计感；π 与 **justhil** 隐性融合——后续可迭代 SVG，spec 不强制一版定稿