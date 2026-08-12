import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildTimelinePageFromSessionFile } from '@shared/session-jsonl-timeline'
import { timelineItemsFromBranchPath } from './worker-timeline'

const tempDirectories: string[] = []
const expandedSkill = `<skill name="demo-skill" location="/skills/demo-skill/SKILL.md">
References are relative to /skills/demo-skill.

# Demo

Secret skill body.
</skill>

history arg`

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('session JSONL skill fixture', () => {
  it('projects the persisted expanded skill block without rewriting disk JSONL', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pi-skill-timeline-'))
    tempDirectories.push(directory)
    const sessionFile = join(directory, 'session.jsonl')
    const entries = [
      { type: 'session', version: 3, id: 'session-1', cwd: directory },
      {
        type: 'message',
        id: 'user-1',
        parentId: null,
        message: { role: 'user', content: [{ type: 'text', text: expandedSkill }] },
      },
      {
        type: 'message',
        id: 'assistant-1',
        parentId: 'user-1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      },
    ]
    const persistedJsonl = `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
    writeFileSync(sessionFile, persistedJsonl, 'utf8')

    const page = await buildTimelinePageFromSessionFile(
      sessionFile,
      {},
      timelineItemsFromBranchPath,
    )

    expect(page.items).toContainEqual(
      expect.objectContaining({
        type: 'user-message',
        text: '/skill:demo-skill history arg',
        sessionEntryId: 'user-1',
      }),
    )
    expect(page.items).not.toContainEqual(
      expect.objectContaining({
        type: 'user-message',
        text: expect.stringContaining('Secret skill body.'),
      }),
    )
    expect(readFileSync(sessionFile, 'utf8')).toBe(persistedJsonl)
  })
})
