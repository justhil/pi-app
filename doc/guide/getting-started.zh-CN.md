# 操作指南

**[English](./getting-started.md)**

面向第一次使用 **pi Desktop** 的开发者。截图：[../images/](../images/)（发布前将占位图换为 `overview.png`）。

---

## 1. 安装与启动

```bash
git clone https://github.com/justhil/pi-app.git
cd pi-app
npm install
npm run dev
```

**前提**：本机终端 pi 已能认证（`~/.pi/agent/auth.json` 或环境变量）。会话与 `settings.json` 与终端共用。

**本地打 Windows 包**：`npm run icon:export && npm run package:win` → `dist/`

**安装包下载**：[GitHub Releases](https://github.com/justhil/pi-app/releases/latest)（安装版 + 便携版）。

---

## 2. 第一次打开（5 步）

1. **磁盘项目** — 左栏打开文件夹（Agent 工具 cwd）。
2. **或沙箱对话** — 「对话分区」，cwd 在应用用户数据目录。
3. **会话** — 选历史或 `+` 新建；磁盘项目可右键重命名/删除。
4. **输入区** — `Enter` 发送；`/` 命令；拖文件或 `+`；`Ctrl+V` 图片；消息内 **KaTeX**。
5. **右栏** — 审查、运行、上下文、**会话树**；输入为空 **双击 Esc** 开树浮层。

---

## 3. 日常操作

| 操作 | 方式 |
|------|------|
| 换行 | `Shift+Enter` |
| 发送历史 | 输入空且光标在顶：`↑` / `↓` |
| 拉回排队 | `Alt+↑`（运行中） |
| 停止生成 | `Esc` |
| 排队跟进 | 运行中继续发送，当前轮次结束后执行 |
| 跳转节点 | 消息悬停 Undo，或会话树 |
| 模型 / 思考 | 输入区底部 pill |
| 语言 | **设置 → 常规** → 中文 / English |
| 语音 | 输入区麦克风；**设置 → 语音输入** 配置 codex-asr |

完整快捷键：[README.zh-CN.md](../../README.zh-CN.md#键盘快捷键)。

---

## 4. 扩展（插件）

1. 终端：`pi install npm:<包名>` 或 `pi install git:github.com/...`
2. 确认 `~/.pi/agent/settings.json` 的 `packages`。
3. 桌面 **设置 → 扩展** — 看**当前会话**已加载工具。
4. 没有工具：**重启 Worker 会话**（新建会话或重开项目）。
5. 弹窗类扩展自动弹出；配置在 **设置 → 桌面适配器**。

列表：[adapters.zh-CN.md](./adapters.zh-CN.md)。编写适配器：[adapter-authoring-guide.md](../adapter-authoring-guide.md)。

---

## 5. 常见问题

| 现象 | 处理 |
|------|------|
| 白屏 / 热更新失效 | 删 `node_modules/.vite`，再 `npm run dev` |
| 设置里有扩展，对话没工具 | 查 `packages` + **重启会话** |
| 切换会话慢 | 先最近一段；发送或树跳转后完整绑定 |
| 语音不可用 | 设置 → 语音输入；不影响打字 |
| 弹窗被关掉 | 时间线「继续作答」或处理「稍后作答」 |

社区：[LinuxDo](https://linux.do/)