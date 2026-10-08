import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

test('activity keeps the title and opens a running session from another project', async () => {
  const model = startScriptedModel(() => ({ text: 'Background work complete', delayMs: 8000 }), [])
  const agent = await launchAgentApp(await listen(model))
  try {
    await agent.newSession()
    await agent.send('Background task')
    await expect.poll(() => agent.win.evaluate(async () => {
      const api = (window as unknown as { piDesktop: { invoke: (channel: string) => Promise<{ workers: { running: boolean }[] }> } }).piDesktop
      return (await api.invoke('ipc:desktop.status')).workers.some((worker) => worker.running)
    })).toBe(true)

    const other = path.join(agent.home, 'code', 'other')
    fs.mkdirSync(other, { recursive: true })
    await agent.win.evaluate((workspace) => {
      const { useUIStore } = (window as unknown as { __piE2E: { useUIStore: { getState: () => {
        setWorkspace: (path: string) => void
        clearTimeline: () => void
        setHistoryMeta: (total: number, loaded: number, file: null) => void
        setHistoryLoading: (loading: boolean) => void
        setRunState: (state: { status: 'idle' }) => void
      } } } }).__piE2E
      const store = useUIStore.getState()
      store.setWorkspace(workspace)
      store.clearTimeline()
      store.setHistoryMeta(0, 0, null)
      store.setHistoryLoading(false)
      store.setRunState({ status: 'idle' })
    }, other)

    await agent.win.getByRole('button', { name: 'Session activity' }).click()
    const activity = agent.win.getByRole('dialog', { name: 'Session activity' })
    await activity.getByRole('button', { name: /Background task/ }).click()
    await expect(activity).toHaveCount(0)
    await expect(agent.win.getByText('Background work complete').first()).toBeVisible()
    await expect.poll(() => agent.win.evaluate(() => {
      const { useUIStore } = (window as unknown as { __piE2E: { useUIStore: { getState: () => { currentWorkspace: string } } } }).__piE2E
      return useUIStore.getState().currentWorkspace
    })).toBe(agent.project)
  } finally {
    await agent.close()
    model.close()
  }
})
