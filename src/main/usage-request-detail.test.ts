import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readUsageRequestDetailFromFile } from './usage-request-detail'

describe('readUsageRequestDetailFromFile', () => {
  it('should_reconstruct_exact_request_context_with_focusStartIndex_and_response_from_local_jsonl_without_creating_files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-usage-detail-'))
    const file = join(dir, 'sess.jsonl')
    const bigBase64 = 'A'.repeat(16_000)

    const entries = [
      {
        type: 'session',
        version: 3,
        id: 'sess-detail-1',
        timestamp: '2026-10-06T00:00:00.000Z',
        cwd: '/work/demo',
      },
      {
        type: 'message',
        id: 'sys-1',
        parentId: null,
        timestamp: '2026-10-06T00:00:00.100Z',
        message: {
          role: 'system',
          content: 'Base system instructions.',
          sections: { env: 'Windows 11' },
          toolsAdded: [{ name: 'read', description: 'Read file' }],
          timestamp: 1000,
        },
      },
      {
        type: 'message',
        id: 'u-1',
        parentId: 'sys-1',
        timestamp: '2026-10-06T00:00:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'First turn question' }],
          timestamp: 2000,
        },
      },
      {
        type: 'message',
        id: 'a-1',
        parentId: 'u-1',
        timestamp: '2026-10-06T00:00:02.000Z',
        message: {
          role: 'assistant',
          api: 'anthropic-messages',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          stopReason: 'stop',
          content: [{ type: 'text', text: 'First turn answer' }],
          usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { total: 0.001 } },
          timestamp: 2100,
        },
      },
      // Second turn: user prompt with embedded image -> assistant toolCall -> toolResult -> final assistant reply (target!)
      {
        type: 'message',
        id: 'u-2',
        parentId: 'a-1',
        timestamp: '2026-10-06T00:00:05.000Z',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect package.json and summarize' },
            { type: 'image', mimeType: 'image/png', data: bigBase64 },
          ],
          timestamp: 5000,
        },
      },
      {
        type: 'message',
        id: 'a-2-tool',
        parentId: 'u-2',
        timestamp: '2026-10-06T00:00:06.000Z',
        message: {
          role: 'assistant',
          api: 'anthropic-messages',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          stopReason: 'toolUse',
          content: [
            { type: 'thinking', thinking: 'Need to read package.json' },
            { type: 'toolCall', id: 'tc-read-1', name: 'read', arguments: { path: 'package.json' } },
          ],
          usage: { input: 50, output: 20, cacheRead: 100, cacheWrite: 0, totalTokens: 170, cost: { total: 0.002 } },
          timestamp: 5500,
        },
      },
      {
        type: 'message',
        id: 'tr-2',
        parentId: 'a-2-tool',
        timestamp: '2026-10-06T00:00:06.500Z',
        message: {
          role: 'toolResult',
          toolCallId: 'tc-read-1',
          toolName: 'read',
          isError: false,
          content: [{ type: 'text', text: '{"name":"pi-app"}' }],
          durationMs: 12,
          timestamp: 6400,
        },
      },
      {
        type: 'message',
        id: 'a-2-final',
        parentId: 'tr-2',
        timestamp: '2026-10-06T00:00:08.000Z',
        message: {
          role: 'assistant',
          api: 'anthropic-messages',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          stopReason: 'toolUse',
          content: [
            { type: 'thinking', thinking: 'Package name is pi-app; running check next' },
            { type: 'text', text: 'Found pi-app.' },
            { type: 'toolCall', id: 'tc-bash-2', name: 'bash', arguments: { command: 'npm -v' } },
          ],
          usage: { input: 60, output: 35, cacheRead: 150, cacheWrite: 0, totalTokens: 245, cost: { total: 0.003 } },
          timestamp: 7000,
          durationMs: 1000,
          ttftMs: 250,
        },
      },
      {
        type: 'message',
        id: 'tr-3',
        parentId: 'a-2-final',
        timestamp: '2026-10-06T00:00:08.300Z',
        message: {
          role: 'toolResult',
          toolCallId: 'tc-bash-2',
          toolName: 'bash',
          isError: false,
          content: [{ type: 'text', text: '10.9.0' }],
          durationMs: 45,
          timestamp: 8200,
        },
      },
    ]

    writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')

    const detail = await readUsageRequestDetailFromFile(file, 'a-2-final')

    // Zero extra files created in directory!
    expect(readdirSync(dir)).toEqual(['sess.jsonl'])

    expect(detail.project).toBe('/work/demo')
    expect(detail.sessionTitle).toBe('First turn question')
    expect(detail.entryId).toBe('a-2-final')
    expect(detail.parentId).toBe('tr-2')

    // System prompt + tools reconstructed from session entries
    expect(detail.request.systemSections.some((s) => s.content?.includes('Base system instructions'))).toBe(true)
    expect(detail.request.toolsDeclared.added.map((t) => t.name)).toContain('read')

    // Non-system conversation messages before a-2-final: [u-1, a-1, u-2, a-2-tool, tr-2]
    // Current turn starts at u-2 (index 2)!
    expect(detail.request.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'toolResult',
    ])
    expect(detail.request.focusStartIndex).toBe(2)

    // Image Base64 is summarized, NOT dumped raw
    const u2Blocks = detail.request.messages[2].blocks
    expect(u2Blocks).toContainEqual(
      expect.objectContaining({ type: 'image', mimeType: 'image/png' }),
    )
    expect(JSON.stringify(detail.request.rawContextJson)).not.toContain(bigBase64)

    // Response blocks + child toolResult
    expect(detail.response.blocks).toEqual([
      { type: 'thinking', thinking: 'Package name is pi-app; running check next' },
      { type: 'text', text: 'Found pi-app.' },
      { type: 'toolCall', id: 'tc-bash-2', name: 'bash', arguments: { command: 'npm -v' } },
    ])
    expect(detail.response.toolResults).toEqual([
      {
        toolCallId: 'tc-bash-2',
        toolName: 'bash',
        isError: false,
        text: '10.9.0',
        durationMs: 45,
      },
    ])
  })
})
