import { test, expect } from '@playwright/test'
import { launchAgentApp, listen, startScriptedModel } from './helpers/scripted-agent'

test('renaming two conversations one after another keeps each its own title', async () => {
  const model = startScriptedModel((_first, _tools, last) => ({ text: `ok ${last}` }), [])
  const agent = await launchAgentApp(await listen(model))
  const { win } = agent
  const rows = win.locator('.sidebar-session-row')
  const rename = async (current: string, next: string) => {
    await rows.filter({ hasText: current }).first().click({ button: 'right' })
    await win.getByRole('button', { name: 'Rename', exact: true }).click()
    const input = win.getByRole('dialog').getByRole('textbox')
    await expect(input).toHaveValue(current)
    await input.fill(next)
    await win.keyboard.press('Enter')
    await expect(win.getByRole('dialog')).toHaveCount(0)
  }
  try {
    await agent.newSession()
    await agent.send('first topic')
    await expect(win.getByText('ok first topic').first()).toBeVisible({ timeout: 30_000 })
    await agent.newSession()
    await agent.send('second topic')
    await expect(win.getByText('ok second topic').first()).toBeVisible({ timeout: 30_000 })

    await rename('second topic', 'Renamed second')
    await rename('first topic', 'Renamed first')
    if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT })

    const titles = async () => (await rows.allInnerTexts()).map((text) => text.split('\n')[0].trim())
    await expect.poll(titles).toEqual(expect.arrayContaining(['Renamed first', 'Renamed second']))
    expect((await titles()).filter((title) => title.startsWith('Renamed'))).toHaveLength(2)

    // The list read back from disk agrees.
    await win.getByRole('button', { name: /Reload session and project lists/ }).click()
    await win.waitForTimeout(1500)
    await expect.poll(titles).toEqual(expect.arrayContaining(['Renamed first', 'Renamed second']))
    expect((await titles()).filter((title) => title.startsWith('Renamed'))).toHaveLength(2)
  } finally {
    await agent.close()
    model.close()
  }
})

// The reported case: prompts starting with a pasted image's clipboard path made every row read
// "C:\Users\…\AppData…" once renamed (the summary line shows the first message).
test('rows summarise the typed text, not the pasted image path, before and after renaming', async () => {
  const model = startScriptedModel((_first, _tools, last) => ({ text: `reply ${last.length}` }), [])
  const agent = await launchAgentApp(await listen(model))
  const { win } = agent
  const rows = win.locator('.sidebar-session-row')
  const pasted = (id: string) => `C:\\Users\\me\\AppData\\Roaming\\pi-desktop\\clipboard-images\\pi-clipboard-${id}.png`
  try {
    await agent.newSession()
    await agent.send(`${pasted('aaa')} do the first worksheet`)
    await expect(win.getByText(/^reply \d+$/).first()).toBeVisible({ timeout: 30_000 })
    await agent.newSession()
    await agent.send(`${pasted('bbb')} grade the second report`)
    await expect(win.getByText(/^reply \d+$/).first()).toBeVisible({ timeout: 30_000 })
    await win.getByRole('button', { name: /Reload session and project lists/ }).click()

    await expect(rows.filter({ hasText: 'do the first worksheet' }).first()).toBeVisible({ timeout: 15_000 })
    await expect(rows.filter({ hasText: 'grade the second report' }).first()).toBeVisible()
    await expect(rows.filter({ hasText: 'clipboard-images' })).toHaveCount(0)

    await rows.filter({ hasText: 'grade the second report' }).first().click({ button: 'right' })
    await win.getByRole('button', { name: 'Rename', exact: true }).click()
    await win.getByRole('dialog').getByRole('textbox').fill('Report grading')
    await win.keyboard.press('Enter')
    // A renamed row shows only its name (and time), not the first message under it.
    const renamed = rows.filter({ hasText: 'Report grading' }).first()
    await expect(renamed).toBeVisible()
    await expect(renamed).not.toContainText('grade the second report')
    await expect(rows.filter({ hasText: 'AppData' })).toHaveCount(0)
    if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT.replace('.png', '-paths.png') })
  } finally {
    await agent.close()
    model.close()
  }
})
