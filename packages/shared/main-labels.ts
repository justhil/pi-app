/**
 * Labels the main process writes by itself (worker fatal messages, git/WSL/pool errors that
 * reach the renderer as toast text). They follow the app language from Settings, the same way
 * tray and desktop alerts do - see src/main/ui-language.ts.
 */
export type MainUiLanguage = 'zh' | 'en' | 'ru'

const LABELS: Record<MainUiLanguage, Record<string, string>> = {
  zh: {
    'git.notRepo': '当前目录不是 Git 仓库',
    'git.commandFailed': 'git 命令失败',
    'git.applyFailed': 'git apply 失败',
    'git.applyReverseFailed': 'git apply -R 失败',
    'worker.fatalExit': 'Worker 已退出。请重新打开工作区；若界面空白请先结束任务管理器里多余的 pi Desktop 进程。',
    'wsl.sdkMissingInstall': '[WSL] 发行版 {distro} 内未找到 pi-coding-agent，请在 WSL 中执行 npm i -g @earendil-works/pi-coding-agent',
    'wsl.workerSyncFailed': '[WSL] 无法将 worker 同步到 WSL 发行版（检查 out/main/worker.mjs）',
    'wsl.sdkMissingSwitch': 'WSL 发行版内未检测到 pi-coding-agent，无法切换到全局版本',
    'wsl.sdkMissingPreview': '[WSL] 发行版 {distro} 内未找到 pi-coding-agent',
    'wsl.previewSyncFailed': '[WSL] 无法将 preview utility 同步到发行版',
    'workers.poolLimit': '已达并发任务上限（当前最多同时运行 {max} 个会话任务），请停止其中一个或在「设置 → 常规 / Pi → 并发任务上限」中调高上限。',
    'purge.dirMissing': '目录不存在：{dir}',
    'purge.ghInputRequired': '请输入 GitHub 仓库地址或 owner/repo',
    'purge.ghOnlyGithub': '仅支持 GitHub 仓库地址',
    'purge.ghBadUrl': '无效的 GitHub 仓库 URL',
    'purge.ghFormatExample': '格式示例：ZiChuanLan/some-magic',
    'purge.ghApiFailed': 'GitHub API 请求失败 (HTTP {status})',
    'session.newTitle': '新会话',
  },
  en: {
    'git.notRepo': 'This folder is not a Git repository',
    'git.commandFailed': 'git command failed',
    'git.applyFailed': 'git apply failed',
    'git.applyReverseFailed': 'git apply -R failed',
    'worker.fatalExit': 'The Worker exited. Reopen the workspace; if the window stays blank, end the extra pi Desktop processes in Task Manager.',
    'wsl.sdkMissingInstall': '[WSL] pi-coding-agent was not found in the {distro} distro; run npm i -g @earendil-works/pi-coding-agent inside WSL',
    'wsl.workerSyncFailed': '[WSL] The worker bundle could not be synced into the distro (check out/main/worker.mjs)',
    'wsl.sdkMissingSwitch': 'pi-coding-agent was not detected in the WSL distro; the global version cannot be switched to',
    'wsl.sdkMissingPreview': '[WSL] pi-coding-agent was not found in the {distro} distro',
    'wsl.previewSyncFailed': '[WSL] The preview utility could not be synced into the distro',
    'workers.poolLimit': 'Concurrent task limit reached ({max} sessions may run at once); stop one, or raise the limit in Settings → General / Pi → Max session workers.',
    'purge.dirMissing': 'Folder does not exist: {dir}',
    'purge.ghInputRequired': 'Enter a GitHub repository URL or owner/repo',
    'purge.ghOnlyGithub': 'Only GitHub repository URLs are supported',
    'purge.ghBadUrl': 'Invalid GitHub repository URL',
    'purge.ghFormatExample': 'Format example: ZiChuanLan/some-magic',
    'purge.ghApiFailed': 'GitHub API request failed (HTTP {status})',
    'session.newTitle': 'New session',
  },
  ru: {
    'git.notRepo': 'Эта папка — не Git-репозиторий',
    'git.commandFailed': 'Команда git завершилась сбоем',
    'git.applyFailed': 'git apply завершился сбоем',
    'git.applyReverseFailed': 'git apply -R завершился сбоем',
    'worker.fatalExit': 'Worker завершился. Заново откройте рабочую папку; если окно остаётся пустым, завершите лишние процессы pi Desktop в Диспетчере задач.',
    'wsl.sdkMissingInstall': '[WSL] в дистрибутиве {distro} не найден pi-coding-agent; выполните в WSL npm i -g @earendil-works/pi-coding-agent',
    'wsl.workerSyncFailed': '[WSL] не удалось синхронизировать worker в дистрибутив (проверьте out/main/worker.mjs)',
    'wsl.sdkMissingSwitch': 'pi-coding-agent не найден в дистрибутиве WSL — переключиться на глобальную версию нельзя',
    'wsl.sdkMissingPreview': '[WSL] в дистрибутиве {distro} не найден pi-coding-agent',
    'wsl.previewSyncFailed': '[WSL] не удалось синхронизировать preview utility в дистрибутив',
    'workers.poolLimit': 'Достигнут предел одновременных задач (одновременно можно запускать сессий: {max}); остановите одну из них или увеличьте предел в «Настройки → Основные / Runtime → Максимум worker-сессий».',
    'purge.dirMissing': 'Папка не существует: {dir}',
    'purge.ghInputRequired': 'Укажите адрес GitHub-репозитория или owner/repo',
    'purge.ghOnlyGithub': 'Поддерживаются только адреса GitHub-репозиториев',
    'purge.ghBadUrl': 'Некорректный URL GitHub-репозитория',
    'purge.ghFormatExample': 'Пример формата: ZiChuanLan/some-magic',
    'purge.ghApiFailed': 'Запрос к GitHub API не удался (HTTP {status})',
    'session.newTitle': 'Новая сессия',
  },
}

export type MainLabelKey = keyof (typeof LABELS)['zh']

/** A label in the app language, with `{placeholder}` interpolation. */
export function mainLabel(language: MainUiLanguage, key: MainLabelKey, params?: Record<string, string | number>): string {
  const template = LABELS[language][key] ?? LABELS.zh[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))
}

/** Keys the main process owns - used by the contract test to keep the three sets equal. */
export function mainLabelKeys(): string[] {
  return Object.keys(LABELS.zh).sort()
}
