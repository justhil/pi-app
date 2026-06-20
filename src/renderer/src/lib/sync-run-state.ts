import { refreshComposerRunDisplay } from '@renderer/lib/composer-run-display'

/** Pull model + thinking from Worker / pi 默认配置（切项目、新会话后调用） */
export async function syncRunStateFromWorker(): Promise<void> {
  await refreshComposerRunDisplay()
}