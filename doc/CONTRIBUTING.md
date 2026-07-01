# 贡献与质量门禁

## 本地检查

```bash
npm run typecheck
npm run lint
npm run build
npm run test:scripts
npm run build && npm run test:e2e
node scripts/ci-audit.mjs
```

## CI（`.github/workflows/quality.yml`）

| Job | 说明 |
|-----|------|
| `typecheck` | `tsc` web + node |
| `lint` | ESLint |
| `script-tests` | `build` 后契约测试 |
| `dependency-audit` | `scripts/ci-audit.mjs` |
| `build-win` | Windows 上 `electron-vite build`（打包路径冒烟） |
| `e2e-smoke` | Ubuntu：`build` 后 `playwright test`（Electron 启动烟雾） |

## 依赖审计策略

- **critical**：`npm audit --audit-level=critical` 失败则 CI 红，必须修复或升级依赖。
- **high / moderate**：`ci-audit.mjs` 仅 **warn**，不阻断合并；跟踪上游修复并在发布说明中披露窗口期。见 `doc/THREAT-MODEL.md` 发布门禁。

## FMSM / 架构

- 全量审计产出：`docs/audit/`（本地，不入 git）。
- 进程边界与 IPC：`doc/CONTEXT.md`、`doc/IPC-CONTRACTS.md`。
- PRD 行数与 `as any` 预算：`scripts/tests/fmsm-prd-gates.test.mjs`。