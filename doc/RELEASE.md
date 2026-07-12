# Release 说明

## 发布流程（维护者）

1. 在 `CHANGELOG.md` 顶部追加完整版本记录（用户可感知条目优先）。
2. 在 `package.json` / `package-lock.json` 提升版本号。
3. **GitHub Release 正文**（用户可见「更新说明」，应用内弹窗展示）：
   - 草稿：`node scripts/generate-release-notes.mjs [version]`
   - 用简短条目说明修复 / 新增 / 注意。
   - **不要**只放 CHANGELOG / RELEASE 文档链接占位。
4. 提交 `release: vX.Y.Z — …` 并打 tag `vX.Y.Z` 推送；CI 构建安装包，并用 `generate-release-notes.mjs` 写入 Release body。
5. 若 CI body 不理想，在 GitHub Release 页手动改成正式说明。

## 应用内更新

- 启动后后台检查 GitHub `releases/latest`（设置「自动检查更新」可关；失败静默，不弹窗）。
- 有新版本且未「忽略本版本」时弹窗：更新说明（Release body）+ **本次忽略** / **忽略本版本** / **更新**。
- **本次忽略**：仅本次关闭；**忽略本版本**：本机记住版本号，同版本不再自动弹。
- **更新**：下载当前平台安装包并调用系统打开（Windows Setup / macOS dmg / Linux AppImage 等）。
- 因此 **Release body 必须是用户可读说明**，禁止 CHANGELOG 链接占位（旧模板已废弃）。

## 相关文档

- 本机协作备忘（可选，不进仓库）：根目录 `AGENTS.md`（已被 `.gitignore`）
- 仓库变更记录：`CHANGELOG.md`

